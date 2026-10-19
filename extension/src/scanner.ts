import type { Target } from "../../src/index.js";

import {
  defaultVisibility,
  getElementLabel,
  getElementRole,
  getFormGroup,
  isDisabled,
  normalizeWhitespace,
} from "./labels.js";
import type { ScanOptions, ScannedTarget } from "./types.js";

export type { ScanOptions, ScannedTarget } from "./types.js";

type TraversalRoot = Document | DocumentFragment;

function isNativeTarget(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "button" || tagName === "select" || tagName === "textarea") {
    return true;
  }
  if (tagName === "a") {
    return element.hasAttribute("href");
  }
  if (tagName === "input") {
    return (element.getAttribute("type") ?? "text").toLowerCase() !== "hidden";
  }
  return tagName === "summary";
}

function hasAccessibleRole(element: Element): boolean {
  const role = normalizeWhitespace(element.getAttribute("role"))
    .split(" ", 1)[0]
    ?.toLowerCase();
  return role === "button" || role === "link";
}

function hasNonNegativeTabIndex(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  if (
    tagName === "button" ||
    tagName === "a" ||
    tagName === "input" ||
    tagName === "select" ||
    tagName === "textarea" ||
    tagName === "summary"
  ) {
    return false;
  }

  const tabIndex = element.getAttribute("tabindex");
  if (tabIndex === null) {
    return false;
  }

  const parsed = Number.parseInt(tabIndex, 10);
  return Number.isInteger(parsed) && parsed >= 0;
}

function isInteractive(element: Element): boolean {
  return (
    isNativeTarget(element) ||
    hasAccessibleRole(element) ||
    element.hasAttribute("onclick") ||
    hasNonNegativeTabIndex(element)
  );
}

function hasOverlayMarker(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute("data-pounce-overlay")) {
      return true;
    }
    current = current.parentElement;
  }

  try {
    const root = element.getRootNode();
    const host = (root as { host?: Element }).host;
    if (host) {
      return hasOverlayMarker(host);
    }
  } catch {
    // An inaccessible root cannot contribute an overlay marker.
  }

  return false;
}

function getChildren(root: TraversalRoot): Element[] {
  return Array.from(root.children);
}

function getOpenShadowRoot(element: Element): DocumentFragment | null {
  try {
    const shadowRoot = (element as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    return shadowRoot ?? null;
  } catch {
    return null;
  }
}

function getFrameDocument(element: Element): Document | null {
  if (element.tagName.toLowerCase() !== "iframe") {
    return null;
  }

  try {
    return (element as HTMLIFrameElement).contentDocument;
  } catch {
    return null;
  }
}

function visibilityFor(element: Element, options: ScanOptions): boolean {
  if (options.getVisibility) {
    try {
      return options.getVisibility(element);
    } catch {
      return defaultVisibility(element);
    }
  }
  return defaultVisibility(element);
}

function rectFor(
  element: Element,
  options: ScanOptions,
): { top: number; left: number } {
  if (options.getRect) {
    try {
      const rect = options.getRect(element);
      if (Number.isFinite(rect.top) && Number.isFinite(rect.left)) {
        return rect;
      }
    } catch {
      // Fall through to the browser-provided rectangle.
    }
  }

  try {
    const rect = element.getBoundingClientRect?.();
    if (rect && Number.isFinite(rect.top) && Number.isFinite(rect.left)) {
      return { top: rect.top, left: rect.left };
    }
  } catch {
    // Use the stable origin fallback below.
  }

  return { top: 0, left: 0 };
}

function viewportWidth(document: Document): number {
  try {
    const width = document.defaultView?.innerWidth;
    if (typeof width === "number" && Number.isFinite(width)) {
      return Math.max(width, 1);
    }
  } catch {
    // Use the stable fixture fallback below.
  }
  return 1;
}

function isPrimaryAction(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  const type = (element.getAttribute("type") ?? "").toLowerCase();

  if (tagName === "input") {
    return type === "submit" || type === "image";
  }
  if (tagName === "button") {
    return type === "submit" || (!type && Boolean(element.closest("form")));
  }
  return false;
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function createTargetId(
  role: string,
  label: string,
  formGroup: string,
  structuralPath: string,
  occurrences: Map<string, number>,
  ids: Set<string>,
): string {
  const identity = [role, label, formGroup]
    .map((value) => normalizeWhitespace(value).toLowerCase())
    .join("|");
  const occurrence = (occurrences.get(identity) ?? 0) + 1;
  occurrences.set(identity, occurrence);

  const seed = `${identity}|${structuralPath}|${occurrence}`;
  const prefix = `pounce-${hash(seed)}`;
  let id = prefix;
  let collision = 1;
  while (ids.has(id)) {
    collision += 1;
    id = `${prefix}-${collision}`;
  }
  ids.add(id);
  return id;
}

export function scanDocument(
  document: Document,
  options: ScanOptions = {},
): ScannedTarget[] {
  const scanned: ScannedTarget[] = [];
  const visitedRoots = new WeakSet<object>();
  const occurrences = new Map<string, number>();
  const ids = new Set<string>();
  const widthByDocument = new WeakMap<Document, number>();

  const walkRoot = (root: TraversalRoot, prefix: string): void => {
    if (visitedRoots.has(root)) {
      return;
    }
    visitedRoots.add(root);

    for (const [index, element] of getChildren(root).entries()) {
      walkElement(element, prefix ? `${prefix}/${index}` : String(index));
    }
  };

  const walkElement = (element: Element, structuralPath: string): void => {
    if (hasOverlayMarker(element)) {
      return;
    }

    if (isInteractive(element) && !isDisabled(element)) {
      const role = getElementRole(element);
      const label = getElementLabel(element, role);
      const formGroup = getFormGroup(element);
      const visible = visibilityFor(element, options);
      const rect = rectFor(element, options);
      const ownerDocument = element.ownerDocument;
      const width = widthByDocument.get(ownerDocument) ?? viewportWidth(ownerDocument);
      widthByDocument.set(ownerDocument, width);

      const target: Target = {
        id: createTargetId(role, label, formGroup, structuralPath, occurrences, ids),
        label,
        role,
        formGroup,
        proximity: rect.top * width + rect.left,
        hidden: !visible,
        ...(isPrimaryAction(element) ? { primaryAction: true } : {}),
      };

      scanned.push({ element, target });
    }

    const shadowRoot = getOpenShadowRoot(element);
    if (shadowRoot) {
      walkRoot(shadowRoot, `${structuralPath}/shadow`);
    }

    const frameDocument = getFrameDocument(element);
    if (frameDocument) {
      walkRoot(frameDocument, `${structuralPath}/frame`);
    }

    for (const [index, child] of Array.from(element.children).entries()) {
      walkElement(child, `${structuralPath}/${index}`);
    }
  };

  walkRoot(document, "");
  return scanned;
}
