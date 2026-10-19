const FALLBACK_FORM_GROUP = "document";

export function normalizeWhitespace(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function firstRoleToken(element: Element): string {
  const role = normalizeWhitespace(element.getAttribute("role"));
  return role.split(" ", 1)[0]?.toLowerCase() ?? "";
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

function hiddenByInlineStyle(element: Element): boolean {
  const style = element.getAttribute("style") ?? "";
  return (
    /(?:^|;)\s*display\s*:\s*none\b/i.test(style) ||
    /(?:^|;)\s*visibility\s*:\s*(?:hidden|collapse)\b/i.test(style) ||
    /(?:^|;)\s*opacity\s*:\s*0(?:\D|$)/i.test(style)
  );
}

function hiddenByComputedStyle(element: Element): boolean {
  try {
    const computedStyle = element.ownerDocument.defaultView?.getComputedStyle?.(element);
    return (
      computedStyle?.display === "none" ||
      computedStyle?.visibility === "hidden" ||
      computedStyle?.visibility === "collapse" ||
      computedStyle?.opacity === "0"
    );
  } catch {
    return false;
  }
}

export function isLocallyHidden(element: Element): boolean {
  return (
    element.hasAttribute("hidden") ||
    (element as Element & { hidden?: boolean }).hidden === true ||
    element.getAttribute("aria-hidden")?.toLowerCase() === "true" ||
    hiddenByInlineStyle(element) ||
    hiddenByComputedStyle(element)
  );
}

function visibleText(element: Element): string {
  const parts: string[] = [];

  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3) {
      parts.push(child.nodeValue ?? "");
      continue;
    }

    if (child.nodeType !== 1) {
      continue;
    }

    const childElement = child as Element;
    if (!isLocallyHidden(childElement)) {
      parts.push(visibleText(childElement));
    }
  }

  return normalizeWhitespace(parts.join(""));
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
  const elementId = element.getAttribute("id");
  if (elementId) {
    try {
      const root = element.getRootNode() as Document | DocumentFragment;
      for (const label of Array.from(root.querySelectorAll("label"))) {
        if (label.getAttribute("for") === elementId) {
          const text = visibleText(label);
          if (text) {
            return text;
          }
        }
      }
    } catch {
      // Fall back to the owner document when an element has an unusual root.
    }
  }

  let ancestor = parentOrShadowHost(element);
  while (ancestor) {
    if (ancestor.tagName.toLowerCase() === "label") {
      return visibleText(ancestor);
    }
    ancestor = parentOrShadowHost(ancestor);
  }

  return "";
}

export function getElementLabel(element: Element, role = getElementRole(element)): string {
  const candidates = [
    visibleText(element),
    normalizeWhitespace(element.getAttribute("aria-label")),
    normalizeWhitespace(element.getAttribute("placeholder")),
    normalizeWhitespace(element.getAttribute("title")),
    associatedLabelText(element),
    role,
    element.tagName.toLowerCase(),
  ];

  return candidates.find((candidate) => candidate.length > 0) ?? element.tagName.toLowerCase();
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
    if (ancestor.getAttribute("aria-disabled")?.toLowerCase() === "true") {
      return true;
    }

    if (
      ancestor.tagName.toLowerCase() === "fieldset" &&
      ancestor.hasAttribute("disabled") &&
      !isInsideFirstLegend(element, ancestor)
    ) {
      return true;
    }

    ancestor = parentOrShadowHost(ancestor);
  }

  return false;
}

function isInsideFirstLegend(element: Element, fieldset: Element): boolean {
  const firstLegend = Array.from(fieldset.children).find(
    (child) => child.tagName.toLowerCase() === "legend",
  );
  if (!firstLegend) {
    return false;
  }

  let current: Element | null = element;
  while (current && current !== fieldset) {
    if (current === firstLegend) {
      return true;
    }
    current = parentOrShadowHost(current);
  }

  return false;
}

export function defaultVisibility(element: Element): boolean {
  if (isLocallyHidden(element)) {
    return false;
  }

  try {
    const view = element.ownerDocument.defaultView;
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
