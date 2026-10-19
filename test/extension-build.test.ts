import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { strict as assert } from "node:assert";
import test from "node:test";

type Command = {
  suggested_key?: {
    default?: string;
  };
};

type Manifest = {
  manifest_version: number;
  permissions: string[];
  host_permissions: string[];
  content_scripts: Array<{
    matches: string[];
    js: string[];
    all_frames: boolean;
  }>;
  commands: Record<string, Command>;
  background: {
    service_worker?: string;
    scripts?: string[];
  };
};

const extensionRoot = resolve(process.cwd(), "dist", "extension");

function assertRegularNonEmptyFile(path: string, description: string): void {
  assert.ok(existsSync(path), `${description} is missing`);
  const stats = statSync(path);

  assert.ok(stats.isFile(), `${description} is not a regular file`);
  assert.ok(stats.size > 0, `${description} is empty`);
}

function readManifest(browser: "chrome" | "firefox"): Manifest {
  const manifestPath = join(extensionRoot, browser, "manifest.json");

  assertRegularNonEmptyFile(manifestPath, `${browser} manifest`);
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

function readBundle(browser: "chrome" | "firefox", fileName: string): string {
  const path = join(extensionRoot, browser, fileName);
  assertRegularNonEmptyFile(path, `${browser} ${fileName}`);

  const source = readFileSync(path, "utf8");
  assert.doesNotMatch(
    source,
    /^\s*(?:import|export)(?:\s|\{|\*|$)/m,
    `${browser} ${fileName} contains top-level module syntax`,
  );
  return source;
}

function assertManifestContract(browser: "chrome" | "firefox", manifest: Manifest): void {
  assert.equal(manifest.manifest_version, 3, `${browser} manifest is not MV3`);
  assert.deepEqual(manifest.permissions, ["storage"], `${browser} permissions differ`);
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"], `${browser} hosts differ`);
  assert.equal(manifest.content_scripts.length, 1, `${browser} content script count differs`);
  const [contentScript] = manifest.content_scripts;
  assert.ok(contentScript, `${browser} content script is missing`);
  assert.deepEqual(contentScript.matches, ["<all_urls>"], `${browser} content matches differ`);
  assert.deepEqual(contentScript.js, ["content.js"], `${browser} content files differ`);
  assert.equal(contentScript.all_frames, false, `${browser} all_frames differs`);
  assert.deepEqual(
    Object.keys(manifest.commands).sort(),
    ["input-first", "open"],
    `${browser} command names differ`,
  );

  const open = manifest.commands.open;
  const inputFirst = manifest.commands["input-first"];
  assert.ok(open, `${browser} open command is missing`);
  assert.ok(inputFirst, `${browser} input-first command is missing`);
  assert.deepEqual(open.suggested_key, { default: "Alt+Shift+P" });
  assert.equal(
    Object.prototype.hasOwnProperty.call(inputFirst, "suggested_key"),
    false,
    `${browser} input-first command has a suggested key`,
  );
}

test("compiled extension artifacts satisfy the browser build contract", () => {
  const chrome = readManifest("chrome");
  const firefox = readManifest("firefox");
  const chromeRoot = join(extensionRoot, "chrome");
  const firefoxRoot = join(extensionRoot, "firefox");

  for (const browserRoot of [chromeRoot, firefoxRoot]) {
    for (const fileName of ["manifest.json", "content.js", "background.js"]) {
      assertRegularNonEmptyFile(
        join(browserRoot, fileName),
        `${browserRoot} ${fileName}`,
      );
    }
  }

  assertManifestContract("chrome", chrome);
  assertManifestContract("firefox", firefox);
  assert.deepEqual(chrome.background, { service_worker: "background.js" });
  assert.deepEqual(firefox.background, { scripts: ["background.js"] });

  readBundle("chrome", "content.js");
  readBundle("chrome", "background.js");
  readBundle("firefox", "content.js");
  readBundle("firefox", "background.js");

  const packageJson = JSON.parse(
    readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
  ) as { files?: string[] };
  assert.ok(packageJson.files?.includes("dist/extension"));

  for (const fixture of ["basic.html", "frame.html"]) {
    assert.ok(
      existsSync(resolve(process.cwd(), "dist", "fixtures", fixture)),
      `copied fixture is missing: ${fixture}`,
    );
  }
});
