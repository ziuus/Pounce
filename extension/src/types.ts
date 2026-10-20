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

export interface OpenMessage {
  readonly type: "open";
  readonly inputFirst: boolean;
}

export interface LoadHistoryMessage {
  readonly type: "loadHistory";
  readonly origin: string;
}

export interface RecordPickMessage {
  readonly type: "recordPick";
  readonly origin: string;
  readonly targetId: string;
}

export type BackgroundMessage = LoadHistoryMessage | RecordPickMessage;
export type ExtensionMessage = OpenMessage | BackgroundMessage;

export interface HistoryResponse {
  readonly type: "history";
  readonly history: Readonly<Record<string, number>>;
}

export interface AcknowledgementResponse {
  readonly type: "ack";
}

export type BackgroundResponse = HistoryResponse | AcknowledgementResponse;
