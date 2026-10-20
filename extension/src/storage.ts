import { browserApi, type BrowserApi, type StorageItems } from "./browser.js";

const STORAGE_PREFIX = "pounce:usage:";

export function usageStorageKey(origin: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(origin)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.floor(value));
}

function sanitizeHistory(value: unknown): Map<string, number> {
  const history = new Map<string, number>();
  if (!isPlainObject(value)) {
    return history;
  }

  for (const [targetId, count] of Object.entries(value)) {
    const sanitizedCount = sanitizeCount(count);
    if (sanitizedCount !== undefined) {
      history.set(targetId, sanitizedCount);
    }
  }

  return history;
}

function storedHistory(items: StorageItems, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(items, key) ? items[key] : undefined;
}

export async function loadUsageHistory(
  origin: string,
  api: BrowserApi | undefined = browserApi,
): Promise<ReadonlyMap<string, number>> {
  if (!api) {
    return new Map<string, number>();
  }

  try {
    const key = usageStorageKey(origin);
    const items = await api.storage.local.get(key);
    return sanitizeHistory(storedHistory(items, key));
  } catch {
    return new Map<string, number>();
  }
}

export async function recordPick(
  origin: string,
  targetId: string,
  api: BrowserApi | undefined = browserApi,
): Promise<void> {
  if (!api) {
    return;
  }

  const key = usageStorageKey(origin);
  const history = new Map(await loadUsageHistory(origin, api));
  history.set(targetId, (history.get(targetId) ?? 0) + 1);

  const plainHistory = Object.fromEntries(history.entries());
  try {
    await api.storage.local.set({ [key]: plainHistory });
  } catch {
    // Usage persistence is best-effort and must not break page interaction.
  }
}
