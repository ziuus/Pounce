import { browserApi, type BrowserApi } from "./browser.js";
import {
  loadUsageHistory,
  recordPick,
} from "./storage.js";
import type {
  BackgroundResponse,
  LoadHistoryMessage,
  RecordPickMessage,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLoadHistoryMessage(value: unknown): value is LoadHistoryMessage {
  return (
    isRecord(value) &&
    value.type === "loadHistory" &&
    typeof value.origin === "string"
  );
}

function isRecordPickMessage(value: unknown): value is RecordPickMessage {
  return (
    isRecord(value) &&
    value.type === "recordPick" &&
    typeof value.origin === "string" &&
    typeof value.targetId === "string"
  );
}

function inputFirstForCommand(command: string): boolean | undefined {
  if (command === "open") {
    return false;
  }
  if (command === "input-first") {
    return true;
  }
  return undefined;
}

export async function handleCommand(
  command: string,
  api: BrowserApi | undefined = browserApi,
): Promise<void> {
  const inputFirst = inputFirstForCommand(command);
  if (!api || inputFirst === undefined) {
    return;
  }

  try {
    const tabs = await api.tabs.query({ active: true, lastFocusedWindow: true });
    const activeTab = tabs[0];
    if (!activeTab || typeof activeTab.id !== "number") {
      return;
    }

    await api.tabs.sendMessage(activeTab.id, {
      type: "open",
      inputFirst,
    });
  } catch {
    // Restricted pages do not accept content-script messages.
  }
}

export async function handleBackgroundMessage(
  message: unknown,
  api: BrowserApi | undefined = browserApi,
): Promise<BackgroundResponse | undefined> {
  if (!api) {
    return undefined;
  }

  if (isLoadHistoryMessage(message)) {
    const history = await loadUsageHistory(message.origin, api);
    return {
      type: "history",
      history: Object.fromEntries(history.entries()),
    };
  }

  if (isRecordPickMessage(message)) {
    await recordPick(message.origin, message.targetId, api);
    return { type: "ack" };
  }

  return undefined;
}

export function registerBackground(
  api: BrowserApi | undefined = browserApi,
): void {
  if (!api) {
    return;
  }

  api.commands.onCommand.addListener((command) => {
    void handleCommand(command, api);
  });
  api.runtime.onMessage.addListener((message) =>
    handleBackgroundMessage(message, api),
  );
}

registerBackground();
