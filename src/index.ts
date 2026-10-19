export type MatchTier = "exact" | "prefix" | "substring" | "fuzzy";

export interface Target {
  readonly id: string;
  readonly label: string;
  readonly role?: string;
  readonly formGroup?: string;
  readonly primaryAction?: boolean;
  readonly proximity?: number;
  readonly hidden?: boolean;
}

export interface SearchOptions {
  readonly usageHistory?: ReadonlyMap<string, number>;
}

export interface RankedTarget {
  readonly target: Target;
  readonly matchTier: MatchTier;
  readonly usageCount: number;
  readonly originalIndex: number;
}

export type HintedTarget = RankedTarget & {
  readonly hint: string;
};

const MATCH_TIER_ORDER: Record<MatchTier, number> = {
  exact: 0,
  prefix: 1,
  substring: 2,
  fuzzy: 3,
};

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function tokens(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function compact(value: string): string {
  return tokens(value).join("");
}

function containsInOrder(text: string, query: string): boolean {
  let queryIndex = 0;

  for (const character of text) {
    if (character === query[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === query.length) {
        return true;
      }
    }
  }

  return false;
}

function getMatchTier(label: string, query: string): MatchTier | undefined {
  const normalizedLabel = normalize(label);
  const normalizedQuery = normalize(query);
  const labelTokens = tokens(normalizedLabel);
  const queryTokens = tokens(normalizedQuery);

  if (
    normalizedLabel === normalizedQuery ||
    queryTokens.length > 0 &&
      queryTokens.every((queryToken) => labelTokens.includes(queryToken))
  ) {
    return "exact";
  }

  if (
    queryTokens.length > 0 &&
    queryTokens.every((queryToken) =>
      labelTokens.some((labelToken) => labelToken.startsWith(queryToken)),
    )
  ) {
    return "prefix";
  }

  const compactLabel = compact(normalizedLabel);
  const compactQuery = compact(normalizedQuery);

  if (compactQuery.length > 0 && compactLabel.includes(compactQuery)) {
    return "substring";
  }

  if (
    compactQuery.length > 1 &&
    containsInOrder(compactLabel, compactQuery)
  ) {
    return "fuzzy";
  }

  return undefined;
}

function usageFor(
  targetId: string,
  usageHistory: ReadonlyMap<string, number> | undefined,
): number {
  const usageCount = usageHistory?.get(targetId) ?? 0;
  return Number.isFinite(usageCount) && usageCount > 0 ? usageCount : 0;
}

function compareDescending(left: number, right: number): number {
  if (left === right) {
    return 0;
  }

  return left > right ? -1 : 1;
}

function compareAscending(left: number, right: number): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

export function rankTargets(
  targets: readonly Target[],
  query: string,
  options: SearchOptions = {},
): RankedTarget[] {
  const normalizedQuery = normalize(query);
  const ranked: RankedTarget[] = [];

  targets.forEach((target, originalIndex) => {
    if (normalizedQuery && target.hidden) {
      return;
    }

    const matchTier = normalizedQuery
      ? getMatchTier(target.label, normalizedQuery)
      : "exact";

    if (!matchTier) {
      return;
    }

    ranked.push({
      target,
      matchTier,
      usageCount: usageFor(target.id, options.usageHistory),
      originalIndex,
    });
  });

  ranked.sort((left, right) => {
    const tierComparison = compareAscending(
      MATCH_TIER_ORDER[left.matchTier],
      MATCH_TIER_ORDER[right.matchTier],
    );
    if (tierComparison !== 0) {
      return tierComparison;
    }

    const primaryComparison = compareDescending(
      left.target.primaryAction ? 1 : 0,
      right.target.primaryAction ? 1 : 0,
    );
    if (primaryComparison !== 0) {
      return primaryComparison;
    }

    const usageComparison = compareDescending(
      left.usageCount,
      right.usageCount,
    );
    if (usageComparison !== 0) {
      return usageComparison;
    }

    const proximityComparison = compareAscending(
      left.target.proximity ?? Number.POSITIVE_INFINITY,
      right.target.proximity ?? Number.POSITIVE_INFINITY,
    );
    if (proximityComparison !== 0) {
      return proximityComparison;
    }

    return compareAscending(left.originalIndex, right.originalIndex);
  });

  return ranked;
}

export function assignHints(
  targets: readonly RankedTarget[],
): HintedTarget[] {
  const width = String(Math.max(targets.length, 1)).length;

  return targets.map((target, index) => ({
    ...target,
    hint: String(index + 1).padStart(width, "0"),
  }));
}

export function searchTargets(
  targets: readonly Target[],
  query: string,
  options: SearchOptions = {},
): HintedTarget[] {
  return assignHints(rankTargets(targets, query, options));
}
