const FALLBACK_FORM_GROUP = "document";

export function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function firstRoleToken(element: Element): string {
  const role = normalizeWhitespace(element.getAttribute("role"));
  return role.split(" ", 1)[0]?.toLowerCase() ?? "";
}

export function getElementRole(element: Element): string {
  const explicitRole = firstRoleToken(element);
  if (explicitRole) {
    return explicitRole;
  }

  const tagName = element.tagName.toLowerCase();
  if (tagName === "button") {
    return "button";
  }
  if (tagName === "a" && element.hasAttribute("href")) {
    return "link";
  }
  if (tagName === "input") {
    const inputType = (element.getAttribute("type") ?? "text").toLowerCase();
    if (inputType === "checkbox") {
      return "checkbox";
    }
    if (inputType === "radio") {
      return "radio";
    }
    if (inputType === "range") {
      return "slider";
    }
    if (inputType === "number") {
      return "spinbutton";
    }
    if (["button", "image", "reset", "submit"].includes(inputType)) {
      return "button";
    }
    return "textbox";
  }
  if (tagName === "select") {
    return "combobox";
  }
  if (tagName === "textarea") {
    return "textbox";
  }
  if (tagName === "summary") {
    return "summary";
  }

  return tagName;
}

function associatedLabelText(element: Element): string {
  const ownerDocument = element.ownerDocument;
  const elementId = element.getAttribute("id");
  if (elementId) {
    for (const label of Array.from(ownerDocument.querySelectorAll("label"))) {
      if (label.getAttribute("for") === elementId) {
        const text = normalizeWhitespace(label.textContent);
        if (text) {
          return text;
        }
      }
    }
  }

  let ancestor = element.parentElement;
  while (ancestor) {
    if (ancestor.tagName.toLowerCase() === "label") {
      return normalizeWhitespace(ancestor.textContent);
    }
    ancestor = ancestor.parentElement;
  }

  return "";
}

export function getElementLabel(element: Element, role = getElementRole(element)): string {
  const candidates = [
    normalizeWhitespace(element.textContent),
    normalizeWhitespace(element.getAttribute("aria-label")),
    normalizeWhitespace(element.getAttribute("placeholder")),
    normalizeWhitespace(element.getAttribute("title")),
    associatedLabelText(element),
    role,
    element.tagName.toLowerCase(),
  ];

  return candidates.find((candidate) => candidate.length > 0) ?? element.tagName.toLowerCase();
}

function parentOrShadowHost(element: Element): Element | null {
  if (element.parentElement) {
    return element.parentElement;
  }

  try {
    const root = element.getRootNode();
    const host = (root as { host?: Element }).host;
    return host ?? null;
  } catch {
    return null;
  }
}

function groupLabel(group: Element): string {
  const identifier = normalizeWhitespace(
    group.getAttribute("id") ?? group.getAttribute("name"),
  );
  if (identifier) {
    return identifier;
  }

  const legend = group.querySelector("legend");
  return normalizeWhitespace(legend?.textContent);
}

export function getFormGroup(element: Element): string {
  let ancestor = parentOrShadowHost(element);
  while (ancestor) {
    const tagName = ancestor.tagName.toLowerCase();
    if (tagName === "form" || tagName === "fieldset") {
      const label = groupLabel(ancestor);
      if (label) {
        return label;
      }
    }
    ancestor = parentOrShadowHost(ancestor);
  }

  return FALLBACK_FORM_GROUP;
}

export function isDisabled(element: Element): boolean {
  if (
    element.hasAttribute("disabled") ||
    element.getAttribute("aria-disabled")?.toLowerCase() === "true"
  ) {
    return true;
  }

  let ancestor = parentOrShadowHost(element);
  while (ancestor) {
    if (
      ancestor.tagName.toLowerCase() === "fieldset" &&
      ancestor.hasAttribute("disabled")
    ) {
      return true;
    }
    ancestor = parentOrShadowHost(ancestor);
  }

  return false;
}

function hiddenByInlineStyle(element: Element): boolean {
  const style = element.getAttribute("style") ?? "";
  return (
    /(?:^|;)\s*display\s*:\s*none\b/i.test(style) ||
    /(?:^|;)\s*visibility\s*:\s*(?:hidden|collapse)\b/i.test(style) ||
    /(?:^|;)\s*opacity\s*:\s*0(?:\D|$)/i.test(style)
  );
}

export function defaultVisibility(element: Element): boolean {
  if (
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-hidden")?.toLowerCase() === "true" ||
    hiddenByInlineStyle(element)
  ) {
    return false;
  }

  try {
    const view = element.ownerDocument.defaultView;
    const computedStyle = view?.getComputedStyle?.(element);
    if (
      computedStyle?.display === "none" ||
      computedStyle?.visibility === "hidden" ||
      computedStyle?.visibility === "collapse" ||
      computedStyle?.opacity === "0"
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect?.();
    if (
      rect &&
      typeof view?.innerWidth === "number" &&
      Number.isFinite(view.innerWidth) &&
      (rect.width <= 0 || rect.height <= 0)
    ) {
      return false;
    }
  } catch {
    return true;
  }

  return true;
}
