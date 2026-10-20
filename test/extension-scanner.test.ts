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
      !/(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0)/i.test(
        element.getAttribute("style") ?? "",
      ),
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

test("converts nested iframe positions into top-page coordinates using top-level width", () => {
  const document = parse(`
    <main>
      <iframe id="outer" data-top="20" data-left="30"></iframe>
    </main>
  `);
  const outer = document.querySelector("#outer");
  assert.ok(outer);
  Object.defineProperty(document.defaultView, "innerWidth", {
    configurable: true,
    value: 100,
  });

  const outerDocument = parse(
    `<iframe id="inner" data-top="5" data-left="6"></iframe>`,
  );
  const inner = outerDocument.querySelector("#inner");
  assert.ok(inner);
  const innerDocument = parse(
    `<button data-top="7" data-left="8">Nested frame action</button>`,
  );
  Object.defineProperty(inner, "contentDocument", {
    configurable: true,
    value: innerDocument,
  });
  Object.defineProperty(outer, "contentDocument", {
    configurable: true,
    value: outerDocument,
  });

  const [target] = scanDocument(document, fixtureOptions());

  assert.ok(target);
  assert.equal(target.target.proximity, 32 * 100 + 44);
});

test("propagates hidden state through ancestors, shadow hosts, and iframe hosts", () => {
  const document = parse(`
    <main>
      <div hidden><button id="hidden-parent">Parent hidden</button></div>
      <div aria-hidden="true"><button id="aria-parent">ARIA parent hidden</button></div>
      <div style="visibility:hidden"><button id="css-parent">CSS parent hidden</button></div>
      <x-hidden id="shadow-host" hidden></x-hidden>
      <iframe id="frame-host" aria-hidden="true"></iframe>
    </main>
  `);
  const shadowHost = document.querySelector("#shadow-host");
  const frameHost = document.querySelector("#frame-host");
  assert.ok(shadowHost);
  assert.ok(frameHost);

  const shadowRoot = document.createDocumentFragment();
  const shadowButton = document.createElement("button");
  shadowButton.textContent = "Shadow hidden";
  shadowRoot.append(shadowButton);
  Object.defineProperty(shadowHost, "shadowRoot", {
    configurable: true,
    value: shadowRoot,
  });

  const frameDocument = parse(`<button id="frame-child">Frame hidden</button>`);
  Object.defineProperty(frameHost, "contentDocument", {
    configurable: true,
    value: frameDocument,
  });

  const scanned = scanDocument(document, fixtureOptions());
  const hiddenIds = new Set(
    scanned
      .filter(({ target }) => target.hidden)
      .map(({ element }) => element.getAttribute("id")),
  );

  assert.ok(hiddenIds.has("hidden-parent"));
  assert.ok(hiddenIds.has("aria-parent"));
  assert.ok(hiddenIds.has("css-parent"));
  assert.ok(scanned.some(({ target }) => target.label === "Shadow hidden" && target.hidden));
  assert.ok(hiddenIds.has("frame-child"));
});

test("filters hidden label descendants and resolves labels inside open shadow roots", () => {
  const document = parse(`
    <main>
      <button id="visible-label">
        <span hidden>Hidden text</span>
        <span aria-hidden="true">ARIA text</span>
        <span style="display:none">CSS text</span>
        Visible text
      </button>
      <x-form id="shadow-form"></x-form>
    </main>
  `);
  const shadowHost = document.querySelector("#shadow-form");
  assert.ok(shadowHost);
  const shadowRoot = document.createDocumentFragment();
  const label = document.createElement("label");
  label.setAttribute("for", "shadow-input");
  label.append("Shadow ");
  const hiddenLabelText = document.createElement("span");
  hiddenLabelText.setAttribute("aria-hidden", "true");
  hiddenLabelText.textContent = "hidden";
  label.append(hiddenLabelText, "label");
  const input = document.createElement("input");
  input.id = "shadow-input";
  shadowRoot.append(label, input);
  Object.defineProperty(shadowHost, "shadowRoot", {
    configurable: true,
    value: shadowRoot,
  });

  const scanned = scanDocument(document, fixtureOptions());

  assert.equal(
    scanned.find(({ element }) => element.getAttribute("id") === "visible-label")?.target.label,
    "Visible text",
  );
  assert.equal(
    scanned.find(({ element }) => element.getAttribute("id") === "shadow-input")?.target.label,
    "Shadow label",
  );
});

test("excludes aria-disabled descendants and preserves the first legend exception", () => {
  const document = parse(`
    <main>
      <div aria-disabled="true">
        <button id="aria-child">ARIA disabled child</button>
        <div><input id="aria-grandchild" aria-label="ARIA disabled grandchild"></div>
      </div>
      <fieldset disabled>
        <legend>First legend <button id="legend-child">Legend action</button></legend>
        <button id="fieldset-child">Fieldset action</button>
      </fieldset>
    </main>
  `);

  const scanned = scanDocument(document, fixtureOptions());
  const ids = new Set(scanned.map(({ element }) => element.getAttribute("id")));

  assert.ok(!ids.has("aria-child"));
  assert.ok(!ids.has("aria-grandchild"));
  assert.ok(ids.has("legend-child"));
  assert.ok(!ids.has("fieldset-child"));
});

test("marks a default button as a primary action outside a form", () => {
  const document = parse(`<button id="default-button">Default action</button>`);
  const scanned = scanDocument(document, fixtureOptions());

  assert.equal(scanned[0]?.target.primaryAction, true);
});

test("parses inline opacity as a complete numeric value", () => {
  const document = parse(`
    <main>
      <button id="semi-visible" style="opacity:0.5">Semi-visible</button>
      <button id="transparent" style="opacity:0">Transparent</button>
    </main>
  `);

  const view = document.defaultView;
  assert.ok(view);
  Object.defineProperty(view, "innerWidth", {
    configurable: true,
    value: 100,
  });
  for (const element of Array.from(document.querySelectorAll("*"))) {
    Object.defineProperty(element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 0, left: 0, width: 10, height: 10 }),
    });
  }

  const scanned = scanDocument(document);
  const targetById = new Map(
    scanned.map(({ element, target }) => [element.getAttribute("id"), target]),
  );

  assert.equal(targetById.get("semi-visible")?.hidden, false);
  assert.equal(targetById.get("transparent")?.hidden, true);
});

test("ignores associated labels hidden by themselves or their ancestors", () => {
  const document = parse(`
    <main>
      <label for="hidden-label" hidden>Hidden label</label>
      <input id="hidden-label">
      <label for="aria-label" aria-hidden="true">ARIA hidden label</label>
      <input id="aria-label">
      <div style="display:none">
        <label for="css-label">CSS hidden label</label>
      </div>
      <input id="css-label">
    </main>
  `);

  const scanned = scanDocument(document, fixtureOptions());
  const labelById = new Map(
    scanned.map(({ element, target }) => [element.getAttribute("id"), target.label]),
  );

  assert.equal(labelById.get("hidden-label"), "textbox");
  assert.equal(labelById.get("aria-label"), "textbox");
  assert.equal(labelById.get("css-label"), "textbox");
});

test("propagates disabled state through same-origin iframe contexts", () => {
  const document = parse(`
    <main>
      <iframe id="disabled-frame" disabled></iframe>
      <iframe id="aria-disabled-frame" aria-disabled="true"></iframe>
      <fieldset disabled>
        <legend>Controls <iframe id="legend-frame"></iframe></legend>
        <iframe id="fieldset-frame"></iframe>
      </fieldset>
    </main>
  `);
  const disabledFrame = document.querySelector("#disabled-frame");
  const ariaDisabledFrame = document.querySelector("#aria-disabled-frame");
  const legendFrame = document.querySelector("#legend-frame");
  const fieldsetFrame = document.querySelector("#fieldset-frame");
  assert.ok(disabledFrame);
  assert.ok(ariaDisabledFrame);
  assert.ok(legendFrame);
  assert.ok(fieldsetFrame);

  for (const [frame, label] of [
    [disabledFrame, "Disabled frame child"],
    [ariaDisabledFrame, "ARIA-disabled frame child"],
    [legendFrame, "Legend frame child"],
    [fieldsetFrame, "Fieldset frame child"],
  ] as const) {
    Object.defineProperty(frame, "contentDocument", {
      configurable: true,
      value: parse(`<button>${label}</button>`),
    });
  }

  const scanned = scanDocument(document, fixtureOptions());
  const labels = scanned.map(({ target }) => target.label);

  assert.ok(!labels.includes("Disabled frame child"));
  assert.ok(!labels.includes("ARIA-disabled frame child"));
  assert.ok(labels.includes("Legend frame child"));
  assert.ok(!labels.includes("Fieldset frame child"));
});

test("treats invalid button types as submit actions", () => {
  const document = parse(`
    <main>
      <button id="invalid" type="launch">Invalid type</button>
      <button id="button" type="button">Button type</button>
      <button id="reset" type="reset">Reset type</button>
      <button id="submit" type="submit">Submit type</button>
    </main>
  `);

  const scanned = scanDocument(document, fixtureOptions());
  const primaryById = new Map(
    scanned.map(({ element, target }) => [element.getAttribute("id"), target.primaryAction]),
  );

  assert.equal(primaryById.get("invalid"), true);
  assert.equal(primaryById.get("button"), undefined);
  assert.equal(primaryById.get("reset"), undefined);
  assert.equal(primaryById.get("submit"), true);
});

test("uses deterministic default visibility probes without browser layout", () => {
  const document = parse(`
    <main>
      <button id="zero-rect" data-display="block" data-rect="zero">Zero rect</button>
      <button id="display-none" data-display="none">Display none</button>
      <button id="visibility-hidden" data-visibility="hidden">Visibility hidden</button>
      <button id="opacity-zero" data-opacity="0">Opacity zero</button>
      <button id="opacity-half" data-opacity="0.5">Opacity half</button>
    </main>
  `);
  const view = document.defaultView;
  assert.ok(view);
  Object.defineProperty(view, "innerWidth", {
    configurable: true,
    value: 100,
  });
  view.getComputedStyle = (element: Element) => ({
    display: element.getAttribute("data-display") ?? "block",
    visibility: element.getAttribute("data-visibility") ?? "visible",
    opacity: element.getAttribute("data-opacity") ?? "1",
  }) as CSSStyleDeclaration;

  for (const element of Array.from(document.querySelectorAll("*"))) {
    const zeroRect = element.getAttribute("data-rect") === "zero";
    Object.defineProperty(element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        top: 0,
        left: 0,
        width: zeroRect ? 0 : 10,
        height: zeroRect ? 0 : 10,
      }),
    });
  }

  const scanned = scanDocument(document);
  const hiddenById = new Map(
    scanned.map(({ element, target }) => [element.getAttribute("id"), target.hidden]),
  );

  assert.equal(hiddenById.get("zero-rect"), true);
  assert.equal(hiddenById.get("display-none"), true);
  assert.equal(hiddenById.get("visibility-hidden"), true);
  assert.equal(hiddenById.get("opacity-zero"), true);
  assert.equal(hiddenById.get("opacity-half"), false);
});
