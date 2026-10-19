import { strict as assert } from "node:assert";
import test from "node:test";
import { parseHTML } from "linkedom";

import { scanDocument } from "../extension/src/scanner.js";

function parse(documentHtml: string): Document {
  return parseHTML(documentHtml).document;
}

function fixtureOptions() {
  return {
    getVisibility: (element: Element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true" &&
      !/display\s*:\s*none/i.test(element.getAttribute("style") ?? ""),
    getRect: (element: Element) => ({
      top: Number(element.getAttribute("data-top") ?? 0),
      left: Number(element.getAttribute("data-left") ?? 0),
    }),
  };
}

test("scans native and custom interactive targets into core metadata", () => {
  const document = parse(`
    <form id="settings-form">
      <fieldset name="profile-fields">
        <legend>Profile</legend>
        <button type="submit" data-top="10" data-left="4"> Save\n changes </button>
        <a href="/settings" data-top="20" data-left="5">Settings</a>
        <input type="text" aria-label="Search users" placeholder="Ignored placeholder">
        <input type="checkbox" aria-label="Enable alerts">
        <select aria-label="Theme selector"></select>
        <textarea title="Notes field"></textarea>
        <summary>More details</summary>
        <div role="button" tabindex="0">Custom action</div>
        <div role="link" tabindex="0">Custom link</div>
        <div onclick="openMenu()">Clickable menu</div>
        <div tabindex="0">Focusable panel</div>
      </fieldset>
    </form>
  `);

  const scanned = scanDocument(document, fixtureOptions());
  const byLabel = new Map(scanned.map((entry) => [entry.target.label, entry]));

  assert.deepEqual(
    scanned.map(({ target }) => target.label),
    [
      "Save changes",
      "Settings",
      "Search users",
      "Enable alerts",
      "Theme selector",
      "Notes field",
      "More details",
      "Custom action",
      "Custom link",
      "Clickable menu",
      "Focusable panel",
    ],
  );

  assert.equal(byLabel.get("Save changes")?.target.role, "button");
  assert.equal(byLabel.get("Save changes")?.target.formGroup, "profile-fields");
  assert.equal(byLabel.get("Save changes")?.target.primaryAction, true);
  assert.equal(byLabel.get("Save changes")?.target.proximity, 10 * 1 + 4);
  assert.equal(byLabel.get("Settings")?.target.role, "link");
  assert.equal(byLabel.get("Enable alerts")?.target.role, "checkbox");
  assert.equal(byLabel.get("Theme selector")?.target.role, "combobox");
  assert.equal(byLabel.get("Notes field")?.target.role, "textbox");
  assert.equal(byLabel.get("Focusable panel")?.target.role, "div");
});

test("uses deterministic label precedence and a stable fallback", () => {
  const document = parse(`
    <main>
      <button id="text">Visible text</button>
      <button id="aria" aria-label="ARIA label">Text ignored by precedence</button>
      <input id="placeholder" placeholder="Placeholder label">
      <input id="title" title="Title label">
      <label for="associated">Associated label</label>
      <input id="associated">
      <div id="fallback" role="button" tabindex="0"></div>
    </main>
  `);

  const scanned = scanDocument(document, fixtureOptions());
  const labelById = new Map(
    scanned.map(({ element, target }) => [element.getAttribute("id"), target.label]),
  );

  assert.equal(labelById.get("text"), "Visible text");
  assert.equal(labelById.get("aria"), "Text ignored by precedence");
  assert.equal(labelById.get("placeholder"), "Placeholder label");
  assert.equal(labelById.get("title"), "Title label");
  assert.equal(labelById.get("associated"), "Associated label");
  assert.equal(labelById.get("fallback"), "button");
});

test("excludes disabled and overlay-owned targets while preserving hidden state", () => {
  const document = parse(`
    <main>
      <button id="enabled">Enabled</button>
      <button id="disabled" disabled>Disabled</button>
      <button id="aria-disabled" aria-disabled="true">ARIA disabled</button>
      <button id="hidden" hidden>Hidden</button>
      <button id="aria-hidden" aria-hidden="true">ARIA hidden</button>
      <button id="css-hidden" style="display:none">CSS hidden</button>
      <div data-pounce-overlay>
        <button id="overlay">Overlay button</button>
      </div>
    </main>
  `);

  const scanned = scanDocument(document, fixtureOptions());
  const ids = new Set(scanned.map(({ element }) => element.getAttribute("id")));

  assert.ok(ids.has("enabled"));
  assert.ok(!ids.has("disabled"));
  assert.ok(!ids.has("aria-disabled"));
  assert.ok(!ids.has("overlay"));
  assert.equal(
    scanned.find(({ element }) => element.getAttribute("id") === "hidden")?.target.hidden,
    true,
  );
  assert.equal(
    scanned.find(({ element }) => element.getAttribute("id") === "aria-hidden")?.target.hidden,
    true,
  );
  assert.equal(
    scanned.find(({ element }) => element.getAttribute("id") === "css-hidden")?.target.hidden,
    true,
  );
});

test("walks open shadow roots and accessible iframe documents in stable order", () => {
  const document = parse(`
    <main>
      <button>Before</button>
      <x-menu id="shadow-host"></x-menu>
      <iframe id="same-origin"></iframe>
      <iframe id="cross-origin"></iframe>
      <button>After</button>
    </main>
  `);
  const host = document.querySelector("#shadow-host");
  const sameOriginFrame = document.querySelector("#same-origin");
  const crossOriginFrame = document.querySelector("#cross-origin");
  assert.ok(host);
  assert.ok(sameOriginFrame);
  assert.ok(crossOriginFrame);

  const shadowRoot = document.createDocumentFragment();
  shadowRoot.append(document.createElement("button"));
  shadowRoot.firstChild!.textContent = "Shadow action";
  Object.defineProperty(host, "shadowRoot", { configurable: true, value: shadowRoot });

  const frameDocument = parse(`<button>Frame action</button><a href="/frame">Frame link</a>`);
  Object.defineProperty(sameOriginFrame, "contentDocument", {
    configurable: true,
    value: frameDocument,
  });
  Object.defineProperty(crossOriginFrame, "contentDocument", {
    configurable: true,
    get() {
      throw new Error("cross-origin");
    },
  });

  const first = scanDocument(document, fixtureOptions());
  const second = scanDocument(document, fixtureOptions());

  assert.deepEqual(
    first.map(({ target }) => target.label),
    ["Before", "Shadow action", "Frame action", "Frame link", "After"],
  );
  assert.deepEqual(
    second.map(({ target }) => target.id),
    first.map(({ target }) => target.id),
  );
  assert.equal(new Set(first.map(({ target }) => target.id)).size, first.length);
});

test("does not put element references into core targets", () => {
  const document = parse(`<button>One</button><button>One</button>`);
  const scanned = scanDocument(document, fixtureOptions());
  const ids = scanned.map(({ target }) => target.id);

  assert.equal(scanned.length, 2);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(scanned.every(({ target }) => !Object.prototype.hasOwnProperty.call(target, "element")));
  assert.notEqual(ids[0], ids[1]);
});
