import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = join(root, "extension");
const outputRoot = join(root, "dist", "extension");

await rm(outputRoot, { recursive: true, force: true });
await rm(join(root, "dist", "fixtures"), { recursive: true, force: true });

for (const browser of ["chrome", "firefox"]) {
  const browserOutput = join(outputRoot, browser);
  await mkdir(browserOutput, { recursive: true });

  await build({
    bundle: true,
    entryPoints: [join(extensionRoot, "src", "content.ts")],
    format: "iife",
    outfile: join(browserOutput, "content.js"),
    platform: "browser",
    target: "es2022"
  });

  await build({
    bundle: true,
    entryPoints: [join(extensionRoot, "src", "background.ts")],
    format: "iife",
    outfile: join(browserOutput, "background.js"),
    platform: "browser",
    target: "es2022"
  });

  await cp(
    join(extensionRoot, `manifest.${browser}.json`),
    join(browserOutput, "manifest.json")
  );
}

await cp(join(root, "test", "fixtures"), join(root, "dist", "fixtures"), {
  recursive: true
});
