export interface StorageItems {
  readonly [key: string]: unknown;
}

export interface Tab {
  readonly id?: number;
}

export interface TabsQuery {
  readonly active?: boolean;
  readonly currentWindow?: boolean;
  readonly lastFocusedWindow?: boolean;
}

export interface BrowserApi {
  readonly commands: {
    readonly onCommand: {
      addListener(listener: (command: string) => unknown): void;
    };
  };
  readonly runtime: {
    readonly onMessage: {
      addListener(
        listener: (message: unknown, sender: unknown) => unknown,
      ): void;
    };
    sendMessage(message: unknown): Promise<unknown>;
  };
  readonly tabs: {
    query(query: TabsQuery): Promise<readonly Tab[]>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
  };
  readonly storage: {
    readonly local: {
      get(
        keys?: string | readonly string[] | null,
      ): Promise<StorageItems>;
      set(items: StorageItems): Promise<void>;
    };
  };
}

type RawMethod = (...args: unknown[]) => unknown;

interface RawEvent {
  readonly addListener: RawMethod;
}

interface RawRuntime {
  readonly onMessage: RawEvent;
  readonly sendMessage: RawMethod;
  readonly lastError?: { readonly message?: string };
}

interface RawBrowserApi {
  readonly commands: { readonly onCommand: RawEvent };
  readonly runtime: RawRuntime;
  readonly tabs: {
    readonly query: RawMethod;
    readonly sendMessage: RawMethod;
  };
  readonly storage: {
    readonly local: {
      readonly get: RawMethod;
      readonly set: RawMethod;
    };
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFunction(value: unknown): value is RawMethod {
  return typeof value === "function";
}

function isResponseCallback(
  value: unknown,
): value is (response: unknown) => void {
  return typeof value === "function";
}

function readRawApi(source: unknown): RawBrowserApi | undefined {
  if (!isObject(source)) {
    return undefined;
  }

  const commands = source.commands;
  const runtime = source.runtime;
  const tabs = source.tabs;
  const storage = source.storage;
  const local = isObject(storage) ? storage.local : undefined;
  const commandEvents = isObject(commands) ? commands.onCommand : undefined;
  const messageEvents = isObject(runtime) ? runtime.onMessage : undefined;

  if (
    !isObject(commandEvents) ||
    !isFunction(commandEvents.addListener) ||
    !isObject(runtime) ||
    !isObject(messageEvents) ||
    !isFunction(messageEvents.addListener) ||
    !isFunction(runtime.sendMessage) ||
    !isObject(tabs) ||
    !isFunction(tabs.query) ||
    !isFunction(tabs.sendMessage) ||
    !isObject(storage) ||
    !isObject(local) ||
    !isFunction(local.get) ||
    !isFunction(local.set)
  ) {
    return undefined;
  }

  return source as unknown as RawBrowserApi;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    isObject(value) &&
    typeof value.then === "function"
  );
}

function errorFromLastError(value: unknown): Error | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const message = value.message;
  return typeof message === "string" ? new Error(message) : new Error("Browser API call failed");
}

function invoke<T>(
  owner: object,
  method: RawMethod,
  args: readonly unknown[],
  getLastError?: () => unknown,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      callback();
    };

    const callback = (value?: unknown): void => {
      const error = getLastError ? errorFromLastError(getLastError()) : undefined;
      settle(() => {
        if (error) {
          reject(error);
        } else {
          resolve(value as T);
        }
      });
    };

    let result: unknown;
    try {
      result = Reflect.apply(method, owner, [...args, callback]);
    } catch (callbackError) {
      try {
        result = Reflect.apply(method, owner, [...args]);
      } catch {
        reject(callbackError);
        return;
      }
    }

    if (isPromiseLike(result)) {
      result.then(
        (value) => settle(() => resolve(value as T)),
        (error) => settle(() => reject(error)),
      );
    } else if (result !== undefined) {
      settle(() => resolve(result as T));
    }
  });
}

function globalApiSource(): unknown {
  const globals = globalThis as typeof globalThis & {
    browser?: unknown;
    chrome?: unknown;
  };
  return globals.browser ?? globals.chrome;
}

export function createBrowserApi(source: unknown): BrowserApi | undefined {
  const raw = readRawApi(source);
  if (!raw) {
    return undefined;
  }

  const runtimeError = (): unknown => raw.runtime.lastError;

  return {
    commands: {
      onCommand: {
        addListener(listener) {
          raw.commands.onCommand.addListener((command: unknown) =>
            listener(String(command)),
          );
        },
      },
    },
    runtime: {
      onMessage: {
        addListener(listener) {
          raw.runtime.onMessage.addListener(
            (
              message: unknown,
              sender: unknown,
              sendResponse?: unknown,
            ) => {
              let result: unknown;
              try {
                result = listener(message, sender);
              } catch {
                if (isResponseCallback(sendResponse)) {
                  sendResponse(undefined);
                  return true;
                }
                return undefined;
              }

              if (isResponseCallback(sendResponse)) {
                Promise.resolve(result).then(
                  (response) => sendResponse(response),
                  () => sendResponse(undefined),
                );
                return true;
              }

              return result;
            },
          );
        },
      },
      sendMessage(message) {
        return invoke<unknown>(raw.runtime, raw.runtime.sendMessage, [message], runtimeError);
      },
    },
    tabs: {
      query(query) {
        return invoke<readonly Tab[]>(raw.tabs, raw.tabs.query, [query], runtimeError);
      },
      sendMessage(tabId, message) {
        return invoke<unknown>(
          raw.tabs,
          raw.tabs.sendMessage,
          [tabId, message],
          runtimeError,
        );
      },
    },
    storage: {
      local: {
        get(keys) {
          return invoke<StorageItems>(raw.storage.local, raw.storage.local.get, [keys], runtimeError);
        },
        set(items) {
          return invoke<void>(raw.storage.local, raw.storage.local.set, [items], runtimeError);
        },
      },
    },
  };
}

export const browserApi: BrowserApi | undefined = createBrowserApi(globalApiSource());
