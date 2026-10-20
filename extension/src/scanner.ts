import type { Target } from "../../src/index.js";

import {
  defaultVisibility,
  getElementLabel,
  getElementRole,
  getFormGroup,
  isLocallyHidden,
  isDisabled,
  normalizeWhitespace,
} from "./labels.js";
import type { ScanOptions, ScannedTarget } from "./types.js";

export type { ScanOptions, ScannedTarget } from "./types.js";

type TraversalRoot = Document | DocumentFragment;

const documentIdRegistries = new WeakMap<Document, WeakMap<Element, string>>();
const registryCounters = new WeakMap<WeakMap<Element, string>, number>();

interface TraversalContext {
  disabled: boolean;
  hidden: boolean;
  offset: { top: number; left: number };
}

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

  const token = tabIndex.trim();
  if (!/^\+?\d+$/.test(token)) {
    return false;
  }

  const parsed = Number(token);
  return Number.isSafeInteger(parsed) && parsed >= 0;
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
  if (isLocallyHidden(element)) {
    return false;
  }

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
    return type !== "button" && type !== "reset";
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
  element: Element,
  role: string,
  label: string,
  formGroup: string,
  structuralPath: string,
  registry: WeakMap<Element, string>,
  ids: Set<string>,
): string {
  const identity = [role, label, formGroup]
    .map((value) => normalizeWhitespace(value).toLowerCase())
    .join("|");
  const registeredId = registry.get(element);
  if (registeredId && !ids.has(registeredId)) {
    ids.add(registeredId);
    return registeredId;
  }

  let counter = registryCounters.get(registry) ?? 0;
  let id = "";
  do {
    counter += 1;
    id = `pounce-${hash(`${identity}|${structuralPath}|${counter}`)}`;
  } while (ids.has(id));

  registryCounters.set(registry, counter);
  registry.set(element, id);
  ids.add(id);
  return id;
}

function getIdRegistry(
  document: Document,
  options: ScanOptions,
): WeakMap<Element, string> {
  if (options.idRegistry) {
    return options.idRegistry;
  }

  const existingRegistry = documentIdRegistries.get(document);
  if (existingRegistry) {
    return existingRegistry;
  }

  const registry = new WeakMap<Element, string>();
  documentIdRegistries.set(document, registry);
  return registry;
}

export function scanDocument(
  document: Document,
  options: ScanOptions = {},
): ScannedTarget[] {
  const scanned: ScannedTarget[] = [];
  const visitedRoots = new WeakSet<object>();
  const ids = new Set<string>();
  const width = viewportWidth(document);
  const idRegistry = getIdRegistry(document, options);

  const walkRoot = (
    root: TraversalRoot,
    prefix: string,
    context: TraversalContext,
  ): void => {
    if (visitedRoots.has(root)) {
      return;
    }
    visitedRoots.add(root);

    for (const [index, element] of getChildren(root).entries()) {
      walkElement(
        element,
        prefix ? `${prefix}/${index}` : String(index),
        context,
      );
    }
  };

  const walkElement = (
    element: Element,
    structuralPath: string,
    context: TraversalContext,
  ): void => {
    if (hasOverlayMarker(element)) {
      return;
    }

    const hidden = context.hidden || !visibilityFor(element, options);
    const disabled = context.disabled || isDisabled(element);
    const ariaDisabled =
      element.getAttribute("aria-disabled")?.toLowerCase() === "true";
    const descendantDisabled = context.disabled || ariaDisabled;

    if (isInteractive(element) && !disabled) {
      const role = getElementRole(element);
      const label = getElementLabel(element, role);
      const formGroup = getFormGroup(element);
      const rect = rectFor(element, options);

      const target: Target = {
        id: createTargetId(
          element,
          role,
          label,
          formGroup,
          structuralPath,
          idRegistry,
          ids,
        ),
        label,
        role,
        formGroup,
        proximity:
          (context.offset.top + rect.top) * width +
          context.offset.left +
          rect.left,
        hidden,
        ...(isPrimaryAction(element) ? { primaryAction: true } : {}),
      };

      scanned.push({ element, target });
    }

    const shadowRoot = getOpenShadowRoot(element);
    if (shadowRoot) {
      walkRoot(shadowRoot, `${structuralPath}/shadow`, {
        disabled,
        hidden,
        offset: context.offset,
      });
    }

    const frameDocument = getFrameDocument(element);
    if (frameDocument) {
      const frameRect = rectFor(element, options);
      walkRoot(frameDocument, `${structuralPath}/frame`, {
        disabled,
        hidden,
        offset: {
          top: context.offset.top + frameRect.top,
          left: context.offset.left + frameRect.left,
        },
      });
    }

    for (const [index, child] of Array.from(element.children).entries()) {
      walkElement(child, `${structuralPath}/${index}`, {
        disabled: descendantDisabled,
        hidden,
        offset: context.offset,
      });
    }
  };

  walkRoot(document, "", {
    disabled: false,
    hidden: false,
    offset: { top: 0, left: 0 },
  });
  return scanned;
}
