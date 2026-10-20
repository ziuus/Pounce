import { strict as assert } from "node:assert";
import test from "node:test";

import {
  createBrowserApi,
  type BrowserApi,
  type StorageItems,
} from "../extension/src/browser.js";
import {
  loadUsageHistory,
  recordPick,
  usageStorageKey,
} from "../extension/src/storage.js";
import {
  handleBackgroundMessage,
  handleCommand,
  registerBackground,
} from "../extension/src/background.js";

interface FakeApiState {
  readonly storage: Record<string, unknown>;
  readonly commandListeners: Array<(command: string) => unknown>;
  readonly messageListeners: Array<
    (message: unknown, sender: unknown) => unknown
  >;
  activeTabs: Array<{ id?: number }>;
  sentMessages: Array<{ tabId: number; message: unknown }>;
  sendMessageError?: Error;
}

type CommandListener = (command: string) => unknown;
type MessageListener = (message: unknown, sender: unknown) => unknown;

function createFakeApi(
  initialStorage: Record<string, unknown> = {},
): { api: BrowserApi; state: FakeApiState } {
  const state: FakeApiState = {
    storage: { ...initialStorage },
    commandListeners: [],
    messageListeners: [],
    activeTabs: [{ id: 42 }],
    sentMessages: [],
  };

  const api: BrowserApi = {
    commands: {
      onCommand: {
        addListener(listener: CommandListener) {
          state.commandListeners.push(listener);
        },
      },
    },
    runtime: {
      onMessage: {
        addListener(listener: MessageListener) {
          state.messageListeners.push(listener);
        },
      },
      async sendMessage() {
        return undefined;
      },
    },
    tabs: {
      async query() {
        return state.activeTabs;
      },
      async sendMessage(tabId: number, message: unknown) {
        if (state.sendMessageError) {
          throw state.sendMessageError;
        }
        state.sentMessages.push({ tabId, message });
        return undefined;
      },
    },
    storage: {
      local: {
        async get(key: string | readonly string[] | null | undefined) {
          const value = typeof key === "string" ? state.storage[key] : undefined;
          return value === undefined ? {} : { [key as string]: value };
        },
        async set(items: StorageItems) {
          Object.assign(state.storage, items);
        },
      },
    },
  };

  return { api, state };
}

test("loads only finite non-negative integer usage counts", async () => {
  const origin = "https://example.test";
  const { api } = createFakeApi({
    [usageStorageKey(origin)]: {
      negative: -3,
      decimal: 2.9,
      finite: 4,
      infinity: Number.POSITIVE_INFINITY,
      nan: Number.NaN,
      text: "5",
    },
  });

  assert.deepEqual(
    [...(await loadUsageHistory(origin, api)).entries()],
    [
      ["negative", 0],
      ["decimal", 2],
      ["finite", 4],
    ],
  );
});

test("isolates usage storage by the supplied page origin", async () => {
  const firstOrigin = "https://first.example";
  const secondOrigin = "https://second.example";
  const { api, state } = createFakeApi();

  await recordPick(firstOrigin, "save", api);
  await recordPick(secondOrigin, "save", api);

  assert.notEqual(usageStorageKey(firstOrigin), usageStorageKey(secondOrigin));
  assert.deepEqual(state.storage[usageStorageKey(firstOrigin)], { save: 1 });
  assert.deepEqual(state.storage[usageStorageKey(secondOrigin)], { save: 1 });
});

test("sanitizes existing counts before incrementing a pick", async () => {
  const origin = "https://example.test";
  const { api, state } = createFakeApi({
    [usageStorageKey(origin)]: { open: 2.9, broken: "not-a-count" },
  });

  await recordPick(origin, "open", api);

  assert.deepEqual(state.storage[usageStorageKey(origin)], { open: 3 });
});

test("normalizes callback and Promise browser API methods", async () => {
  const callbackListeners: Array<(...args: unknown[]) => unknown> = [];
  const callbackSource = {
    commands: {
      onCommand: {
        addListener(listener: (...args: unknown[]) => unknown) {
          callbackListeners.push(listener);
        },
      },
    },
    runtime: {
      onMessage: {
        addListener() {
          return undefined;
        },
      },
      sendMessage(message: unknown, callback: (response: unknown) => void) {
        assert.deepEqual(message, { type: "ping" });
        callback({ type: "pong" });
      },
    },
    tabs: {
      query(_query: unknown, callback: (tabs: unknown) => void) {
        callback([{ id: 7 }]);
      },
      sendMessage(
        tabId: number,
        message: unknown,
        callback: (response: unknown) => void,
      ) {
        assert.equal(tabId, 7);
        assert.deepEqual(message, { type: "open", inputFirst: false });
        callback({ delivered: true });
      },
    },
    storage: {
      local: {
        get(key: unknown, callback: (items: unknown) => void) {
          callback({ [key as string]: { open: 2 } });
        },
        set(items: unknown, callback: () => void) {
          assert.deepEqual(items, { "pounce:usage:test": { open: 3 } });
          callback();
        },
      },
    },
  };
  const api = createBrowserApi(callbackSource);
  assert.ok(api);

  assert.deepEqual(await api.runtime.sendMessage({ type: "ping" }), {
    type: "pong",
  });
  assert.deepEqual(await api.tabs.query({ active: true }), [{ id: 7 }]);
  assert.deepEqual(
    await api.tabs.sendMessage(7, { type: "open", inputFirst: false }),
    { delivered: true },
  );
  assert.deepEqual(
    await api.storage.local.get("pounce:usage:test"),
    { "pounce:usage:test": { open: 2 } },
  );
  await api.storage.local.set({ "pounce:usage:test": { open: 3 } });
  assert.equal(callbackListeners.length, 0);

  const promiseApi = createBrowserApi({
    commands: { onCommand: { addListener() {} } },
    runtime: {
      onMessage: { addListener() {} },
      sendMessage: async () => ({ type: "promise" }),
    },
    tabs: {
      query: async () => [{ id: 8 }],
      sendMessage: async () => ({ delivered: true }),
    },
    storage: {
      local: {
        get: async () => ({ key: { value: 1 } }),
        set: async () => undefined,
      },
    },
  });
  assert.ok(promiseApi);
  assert.deepEqual(await promiseApi.runtime.sendMessage({}), {
    type: "promise",
  });
  assert.deepEqual(await promiseApi.tabs.query({}), [{ id: 8 }]);
  assert.deepEqual(await promiseApi.storage.local.get("key"), {
    key: { value: 1 },
  });
});

test("normalizes callback and Promise runtime message listeners", async () => {
  let registeredListener:
    | ((...args: unknown[]) => unknown)
    | undefined;
  const api = createBrowserApi({
    commands: { onCommand: { addListener() {} } },
    runtime: {
      onMessage: {
        addListener(listener: (...args: unknown[]) => unknown) {
          registeredListener = listener;
        },
      },
      sendMessage: async () => undefined,
    },
    tabs: {
      query: async () => [],
      sendMessage: async () => undefined,
    },
    storage: {
      local: { get: async () => ({}), set: async () => undefined },
    },
  });
  assert.ok(api);

  let callbackResponse: unknown;
  api.runtime.onMessage.addListener(async () => ({ type: "callback" }));
  assert.ok(registeredListener);
  assert.equal(
    registeredListener(
      { type: "request" },
      {},
      (response: unknown) => {
        callbackResponse = response;
      },
    ),
    true,
  );
  await Promise.resolve();
  assert.deepEqual(callbackResponse, { type: "callback" });

  api.runtime.onMessage.addListener(async () => ({ type: "promise" }));
  assert.ok(registeredListener);
  assert.deepEqual(
    await registeredListener({ type: "request" }, {}),
    { type: "promise" },
  );
});

test("registers commands and maps input-first to the open message", async () => {
  const { api, state } = createFakeApi();
  registerBackground(api);

  assert.equal(state.commandListeners.length, 1);
  await state.commandListeners[0]?.("input-first");

  assert.deepEqual(state.sentMessages, [
    { tabId: 42, message: { type: "open", inputFirst: true } },
  ]);
});

test("registers the runtime message handler", async () => {
  const { api, state } = createFakeApi();
  registerBackground(api);

  assert.equal(state.messageListeners.length, 1);
  assert.deepEqual(
    await state.messageListeners[0]?.(
      { type: "loadHistory", origin: "https://example.test" },
      {},
    ),
    { type: "history", history: {} },
  );
});

test("delivers the normal open command to the active tab", async () => {
  const { api, state } = createFakeApi();

  await handleCommand("open", api);

  assert.deepEqual(state.sentMessages, [
    { tabId: 42, message: { type: "open", inputFirst: false } },
  ]);
});

test("swallows restricted-page delivery failures", async () => {
  const { api, state } = createFakeApi();
  state.sendMessageError = new Error("Cannot access chrome:// page");

  await assert.doesNotReject(handleCommand("open", api));
  assert.deepEqual(state.sentMessages, []);
});

test("handles history and record messages with origin-scoped responses", async () => {
  const origin = "https://example.test";
  const { api } = createFakeApi();

  assert.deepEqual(
    await handleBackgroundMessage({ type: "loadHistory", origin }, api),
    { type: "history", history: {} },
  );
  assert.deepEqual(
    await handleBackgroundMessage(
      { type: "recordPick", origin, targetId: "save" },
      api,
    ),
    { type: "ack" },
  );
  assert.deepEqual(
    await handleBackgroundMessage({ type: "loadHistory", origin }, api),
    { type: "history", history: { save: 1 } },
  );
});

test("returns no response for malformed or unknown messages", async () => {
  const { api } = createFakeApi();

  assert.equal(await handleBackgroundMessage(null, api), undefined);
  assert.equal(
    await handleBackgroundMessage({ type: "loadHistory", origin: 42 }, api),
    undefined,
  );
  assert.equal(
    await handleBackgroundMessage({ type: "unknown" }, api),
    undefined,
  );
});

test("can be registered without a browser API", () => {
  assert.doesNotThrow(() => registerBackground(undefined));
});
