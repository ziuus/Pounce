# Browser Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Chrome/Firefox Manifest V3 extension that scans live pages, ranks interactive targets with Pounce core, and activates them from a keyboard overlay.

**Architecture:** The extension is a separate `extension/` package inside this repository. A content script owns scanning, overlay rendering, keyboard interaction, and activation; a background context owns commands and storage access. The build emits separate Chrome and Firefox manifests because Chrome uses an MV3 service worker while Firefox uses a classic background script. The core library remains browser-independent, with only optional target metadata fields added for extension display and grouping.

**Tech Stack:** TypeScript, Manifest V3, native WebExtension APIs, esbuild for self-contained classic extension bundles, Node’s built-in test runner, and `linkedom` for static HTML fixture tests.

---

## Files and responsibilities

- Modify `src/index.ts`: add optional `role` and `formGroup` target metadata without importing browser APIs.
- Create `extension/manifest.chrome.json` and `extension/manifest.firefox.json`: browser-specific MV3 manifests with two commands and content-script permissions.
- Create `extension/src/browser.ts`: narrow Chrome/Firefox API adapter using `globalThis.browser ?? globalThis.chrome`.
- Create `extension/src/types.ts`: scanner, overlay, and message types.
- Create `extension/src/labels.ts`: deterministic accessible-label and form-group extraction.
- Create `extension/src/scanner.ts`: interactive-element discovery, visibility/position conversion, open shadow-root traversal, same-origin iframe traversal, and stable IDs.
- Create `extension/src/storage.ts`: origin-scoped usage-history load/increment/save operations.
- Create `extension/src/overlay.ts`: fixed overlay UI, live ranking, hint rendering, keyboard handling, activation, and input-first mode.
- Create `extension/src/content.ts`: content-script bootstrap and mutation-observer rescan wiring.
- Create `extension/src/background.ts`: command registration and message delivery to the active tab.
- Create `scripts/copy-extension.mjs`: bundle classic content/background scripts with esbuild, copy browser-specific manifests and static HTML fixtures into `dist/` after TypeScript compilation.
- Create `test/fixtures/basic.html` and `test/fixtures/frame.html`: deterministic static page fixtures.
- Create `test/extension-scanner.test.ts`: scanner and conversion tests using `linkedom`.
- Modify `package.json`, `package-lock.json`, `tsconfig.json`, `README.md`, and `Dockerfile`: build, test, package, Docker, and load instructions.

### Task 1: Extend the core target contract

**Files:** `src/index.ts`, `test/core.test.ts`

- [ ] Add optional `role?: string` and `formGroup?: string` to `Target`.
- [ ] Add a test proving `rankTargets` preserves both metadata fields and still uses the usage-history map in the existing comparator order.
- [ ] Run `npm test` and verify the new test fails before the interface change and passes after it.
- [ ] Commit with `feat: preserve extension target metadata`.

### Task 2: Add extension build and fixture test infrastructure

**Files:** `extension/manifest.chrome.json`, `extension/manifest.firefox.json`, `scripts/copy-extension.mjs`, `test/fixtures/*.html`, `package.json`, `package-lock.json`, `tsconfig.json`, `Dockerfile`

- [ ] Add `linkedom` and `esbuild` as exact dev dependencies with `npm install --save-dev --save-exact linkedom esbuild`.
- [ ] Extend the TypeScript include list to compile `extension/**/*.ts` and keep output under `dist/extension`.
- [ ] Add `scripts/copy-extension.mjs` that creates `dist/extension/chrome` and `dist/extension/firefox`, bundles `content.ts` and `background.ts` as self-contained classic scripts, copies the matching manifest into each directory, and copies `test/fixtures` to `dist/fixtures`.
- [ ] Change `build` to run TypeScript followed by the copy script, and keep `test` as one command that runs all `dist/test/*.test.js` files.
- [ ] Add browser-specific MV3 manifests with `storage` in `permissions`, `<all_urls>` in `host_permissions`, `matches: ["<all_urls>"]`, `all_frames: false`, and two commands. Use `Alt+Shift+P` for open; leave input-first unassigned by default because `Alt+Shift+I` conflicts with Chrome.
- [ ] Add static HTML fixtures containing buttons, links, inputs, selects, textareas, checkboxes, ARIA roles, a hidden element, a disabled element, and a same-origin iframe placeholder.
- [ ] Run `npm test` and verify each emitted directory contains a manifest, `content.js`, and `background.js` before committing `chore: add extension build infrastructure`.

### Task 3: Implement scanner and conversion test-first

**Files:** `extension/src/types.ts`, `extension/src/labels.ts`, `extension/src/scanner.ts`, `test/extension-scanner.test.ts`

- [ ] Write failing fixture tests for native interactive elements, ARIA button/link roles, clickable custom elements, disabled/hidden exclusion, label precedence, `role`, `formGroup`, `proximity`, stable unique IDs, and empty-label fallback.
- [ ] Write a failing test that scans an open shadow root and a same-origin iframe document while ignoring an inaccessible/cross-origin iframe.
- [ ] Define the scanner boundary as:

```ts
export interface ScanOptions {
  getVisibility?: (element: Element) => boolean;
  getRect?: (element: Element) => { top: number; left: number };
}

export interface ScannedTarget {
  element: Element;
  target: Target;
}

export function scanDocument(
  document: Document,
  options?: ScanOptions,
): ScannedTarget[];
```

- [ ] Implement label precedence as visible text, `aria-label`, `placeholder`, `title`, associated label text, then role/tag fallback.
- [ ] Implement visibility using disabled/hidden/`aria-hidden`, computed display/visibility/opacity, and non-zero client rects; make the injected options deterministic for fixtures.
- [ ] Discover `button`, links with `href`, form controls, `summary`, ARIA `button`/`link`, elements with `onclick`, and non-native elements with non-negative `tabindex`.
- [ ] Traverse each document’s open shadow roots and same-origin iframe `contentDocument` values with guarded access.
- [ ] Convert screen position to core `proximity` using `top * max(innerWidth, 1) + left`, set `hidden` from visibility, set `primaryAction` for submit controls, and derive form groups from the nearest form/fieldset.
- [ ] Generate stable IDs from normalized role, label, form group, structural path, and duplicate occurrence; do not store element references in core targets.
- [ ] Run the scanner tests and full `npm test`; commit `feat: scan page targets for extension ranking`.

### Task 4: Add storage and background command plumbing

**Files:** `extension/src/browser.ts`, `extension/src/storage.ts`, `extension/src/background.ts`, `extension/src/types.ts`, `test/extension-scanner.test.ts` if shared types need coverage

- [ ] Add a typed API adapter that supports `commands`, `runtime`, `tabs`, and `storage.local` on both Chrome and Firefox without adding browser code to `src/`; normalize Promise/callback differences in the adapter.
- [ ] Store only `{ [targetId: string]: number }` under an origin-scoped key derived from the page origin sent by the content script; never derive it from the background context’s extension origin.
- [ ] Implement `loadUsageHistory(origin)` and `recordPick(origin, targetId)` with missing/invalid storage treated as an empty map and counts clamped to non-negative finite integers.
- [ ] Register the two manifest commands and send `{ type: "open", inputFirst: boolean }` to the active tab’s content script; handle `{ type: "loadHistory", origin }` and `{ type: "recordPick", origin, targetId }` messages from content scripts.
- [ ] Keep command delivery failure non-fatal for restricted pages where content scripts cannot run.
- [ ] Run `npm test`; commit `feat: add extension commands and usage storage`.

### Task 5: Implement overlay, activation, and mutation rescans

**Files:** `extension/src/overlay.ts`, `extension/src/content.ts`, `extension/src/types.ts`

- [ ] Write focused tests for pure key-to-target behavior where practical: Esc closes, digit sequences select matching hints, Enter selects the top result, and input-first mode restricts results to form fields.
- [ ] Create a fixed, high-z-index overlay with a search input and result list. Mark it with `data-pounce-overlay` and exclude it from scanner results.
- [ ] On open, scan the document, load origin history, render visible hints for the empty query, and focus the overlay input. In input-first mode, filter to inputs/selects/textareas/checkboxes and focus the first field candidate.
- [ ] On each input event, call `searchTargets(scannedTargets, query, { usageHistory })` and redraw results and hints without mutating page content.
- [ ] On digit keys, collect a short sequence and activate the exact hint; on Enter, activate the first result; on Escape, close and restore the previous active element when possible.
- [ ] Activate links and clickable controls with `.click()`. Focus form controls and select/textarea inputs without submitting them unless the user explicitly selects a submit control.
- [ ] Record the selected target ID through `recordPick` before closing, then rescan after a successful activation when the page remains open.
- [ ] Install a debounced `MutationObserver` on the top document and keep the current query/mode while replacing stale result mappings.
- [ ] Run `npm test`; commit `feat: add keyboard overlay interactions`.

### Task 6: Document loading, packaging, and final verification

**Files:** `README.md`, `Dockerfile`, `package.json`, `package-lock.json`

- [ ] Document `npm ci`, `npm test`, `npm run build`, and the emitted extension directories `dist/extension/chrome` and `dist/extension/firefox`.
- [ ] Add Chrome instructions: `chrome://extensions`, Developer mode, Load unpacked, choose `dist/extension/chrome`, and configure input-first in the extension shortcuts page.
- [ ] Add Firefox instructions: `about:debugging#/runtime/this-firefox`, Load Temporary Add-on, choose `dist/extension/firefox/manifest.json`.
- [ ] Update Dockerfile to copy extension sources/fixtures and run the single `npm test` command.
- [ ] Run `npm test`, `npm run typecheck`, `npm pack --dry-run`, and `git diff --check`.
- [ ] If Docker is installed, run `docker build -t pounce . && docker run --rm pounce`; otherwise record Docker as unverified rather than claiming it passed.
- [ ] Commit `docs: document extension loading and verification`.
