import type { Target } from "../../src/index.js";

export interface ScanOptions {
  getVisibility?: (element: Element) => boolean;
  getRect?: (element: Element) => { top: number; left: number };
  idRegistry?: WeakMap<Element, string>;
}

export interface ScannedTarget {
  element: Element;
  target: Target;
}
