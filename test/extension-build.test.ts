import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { strict as assert } from "node:assert";
import test from "node:test";

type Manifest = {
  manifest_version: number;
  permissions: string[];
  host_permissions: string[];
  content_scripts: Array<{ js: string[] }>;
  commands: Record<string, unknown>;
  background: {
    service_worker?: string;
    scripts?: string[];
  };
};

const extensionRoot = resolve(process.cwd(), "dist", "extension");

function readManifest(browser: "chrome" | "firefox"): Manifest {
  const manifestPath = join(extensionRoot, browser, "manifest.json");

  assert.ok(existsSync(manifestPath), `${browser} manifest is missing`);
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

function assertFilesExist(browserRoot: string, paths: readonly string[]): void {
  for (const path of paths) {
    assert.ok(existsSync(join(browserRoot, path)), `missing compiled file: ${path}`);
  }
}

test("compiled extension artifacts are complete and browser manifests stay in parity", () => {
  const chrome = readManifest("chrome");
  const firefox = readManifest("firefox");
  const chromeRoot = join(extensionRoot, "chrome");
  const firefoxRoot = join(extensionRoot, "firefox");

  for (const field of [
    "manifest_version",
    "permissions",
    "host_permissions",
    "content_scripts",
    "commands",
  ] as const) {
    assert.deepEqual(chrome[field], firefox[field], `${field} differs between browsers`);
  }

  assert.equal(chrome.manifest_version, 3);
  assert.equal(typeof chrome.background.service_worker, "string");
  assert.deepEqual(firefox.background.scripts, ["background.js"]);

  const chromeBackground = chrome.background.service_worker;
  const firefoxBackground = firefox.background.scripts;
  assert.ok(chromeBackground);
  assert.ok(firefoxBackground);

  assertFilesExist(chromeRoot, [
    chromeBackground,
    ...chrome.content_scripts.flatMap(({ js }) => js),
  ]);
  assertFilesExist(firefoxRoot, [
    ...firefoxBackground,
    ...firefox.content_scripts.flatMap(({ js }) => js),
  ]);

  for (const fixture of ["basic.html", "frame.html"]) {
    assert.ok(
      existsSync(resolve(process.cwd(), "dist", "fixtures", fixture)),
      `copied fixture is missing: ${fixture}`,
    );
  }
});
