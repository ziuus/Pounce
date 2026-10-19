import { strict as assert } from "node:assert";
import test from "node:test";

import {
  assignHints,
  rankTargets,
  searchTargets,
  type Target,
} from "../src/index.js";

const usageHistory = new Map([
  ["primary", 2],
  ["file-opener", 100],
  ["export", 10],
  ["filet", 50],
  ["profile", 1_000],
]);

function ids(results: readonly { target: Target }[]): string[] {
  return results.map((result) => result.target.id);
}

test("ranks exact tokens before prefixes and substrings", () => {
  const targets: Target[] = [
    { id: "primary", label: "Open File", primaryAction: true, proximity: 3 },
    { id: "file-opener", label: "File Opener", proximity: 20 },
    { id: "export", label: "Export File", proximity: 2 },
    { id: "filet", label: "Filet", proximity: 1 },
    { id: "profile", label: "Profile", proximity: 0 },
    { id: "hidden", label: "Hidden File", hidden: true },
  ];

  const results = rankTargets(targets, "file", { usageHistory });

  assert.deepEqual(ids(results), [
    "primary",
    "file-opener",
    "export",
    "filet",
    "profile",
  ]);
  assert.equal(results[0]?.matchTier, "exact");
  assert.equal(results[3]?.matchTier, "prefix");
  assert.equal(results[4]?.matchTier, "substring");
});

test("orders primary actions before usage and proximity within a match tier", () => {
  const targets: Target[] = [
    { id: "near", label: "Alpha", proximity: 1 },
    { id: "frequent", label: "Alps", proximity: 10 },
    { id: "primary", label: "Alto", primaryAction: true, proximity: 100 },
  ];

  const results = rankTargets(targets, "al", {
    usageHistory: new Map([
      ["near", 1],
      ["frequent", 100],
      ["primary", 0],
    ]),
  });

  assert.deepEqual(ids(results), ["primary", "frequent", "near"]);
});

test("preserves extension metadata while ranking by usage history", () => {
  const targets: Target[] = [
    {
      id: "less-used",
      label: "Open File",
      role: "menuitem",
      formGroup: "files",
    },
    {
      id: "more-used",
      label: "Open Folder",
      role: "menuitem",
      formGroup: "files",
    },
  ];

  const results = rankTargets(targets, "open", {
    usageHistory: new Map([
      ["less-used", 1],
      ["more-used", 2],
    ]),
  });

  assert.deepEqual(ids(results), ["more-used", "less-used"]);
  assert.deepEqual(
    results.map(({ target }) => ({
      id: target.id,
      role: target.role,
      formGroup: target.formGroup,
    })),
    [
      { id: "more-used", role: "menuitem", formGroup: "files" },
      { id: "less-used", role: "menuitem", formGroup: "files" },
    ],
  );
});

test("uses proximity after primary action and usage count", () => {
  const targets: Target[] = [
    { id: "far", label: "Alpha", proximity: 10 },
    { id: "near", label: "Alps", proximity: 1 },
  ];

  const results = rankTargets(targets, "al", {
    usageHistory: new Map([
      ["far", 5],
      ["near", 5],
    ]),
  });

  assert.deepEqual(ids(results), ["near", "far"]);
});

test("uses original input order as the final deterministic tie-breaker", () => {
  const targets: Target[] = [
    { id: "first", label: "Same" },
    { id: "second", label: "Same" },
  ];

  assert.deepEqual(ids(rankTargets(targets, "same")), ["first", "second"]);
});

test("places fuzzy matches after substring matches", () => {
  const targets: Target[] = [
    { id: "substring", label: "zabc shortcut" },
    { id: "fuzzy", label: "A Brave Cat" },
  ];

  const results = rankTargets(targets, "abc");

  assert.deepEqual(ids(results), ["substring", "fuzzy"]);
  assert.equal(results[1]?.matchTier, "fuzzy");
});

test("includes hidden targets for an empty query and excludes them for matches", () => {
  const targets: Target[] = [
    { id: "visible", label: "Open" },
    { id: "hidden", label: "Open Secret", hidden: true },
  ];

  assert.deepEqual(ids(rankTargets(targets, "open")), ["visible"]);
  assert.deepEqual(ids(rankTargets(targets, "  ")), ["visible", "hidden"]);
});

test("normalizes whitespace and case in labels and queries", () => {
  const targets: Target[] = [{ id: "open", label: "Open    File" }];

  assert.deepEqual(ids(rankTargets(targets, "  OPEN   FILE  ")), ["open"]);
});

test("returns no results when no visible target matches", () => {
  const targets: Target[] = [
    { id: "one", label: "One" },
    { id: "two", label: "Two" },
  ];

  assert.deepEqual(searchTargets(targets, "missing"), []);
});

test("orders empty-query results using primary action, usage, and proximity", () => {
  const targets: Target[] = [
    { id: "far", label: "Far", proximity: 10 },
    { id: "near", label: "Near", proximity: 1 },
    { id: "primary", label: "Primary", primaryAction: true, proximity: 100 },
  ];

  assert.deepEqual(
    ids(
      rankTargets(targets, "", {
        usageHistory: new Map([
          ["far", 5],
          ["near", 5],
          ["primary", 0],
        ]),
      }),
    ),
    ["primary", "near", "far"],
  );
});

test("returns no results when a non-empty query only matches hidden targets", () => {
  const targets: Target[] = [{ id: "hidden", label: "Secret", hidden: true }];

  assert.deepEqual(searchTargets(targets, "secret"), []);
});

test("does not mutate targets or the usage history map", () => {
  const targets: Target[] = [
    { id: "one", label: "One", proximity: 2 },
    { id: "two", label: "Two", proximity: 1 },
  ];
  const originalTargets = structuredClone(targets);
  const originalHistory = new Map([["one", 5]]);

  searchTargets(targets, "one", { usageHistory: originalHistory });

  assert.deepEqual(targets, originalTargets);
  assert.deepEqual([...originalHistory], [["one", 5]]);
});

test("assigns contiguous fixed-width hints without prefixes", () => {
  const targets: Target[] = Array.from({ length: 12 }, (_, index) => ({
    id: `target-${index}`,
    label: `Target ${index}`,
  }));

  const results = searchTargets(targets, "");
  const hints = results.map((result) => result.hint);

  assert.deepEqual(hints, [
    "01",
    "02",
    "03",
    "04",
    "05",
    "06",
    "07",
    "08",
    "09",
    "10",
    "11",
    "12",
  ]);
  assert.equal(
    hints.every((hint, index) =>
      hints.every(
        (otherHint, otherIndex) =>
          index === otherIndex ||
          (!otherHint.startsWith(hint) && !hint.startsWith(otherHint)),
      ),
    ),
    true,
  );
});

test("uses one-digit hints for nine results and padded hints for ten", () => {
  const makeTargets = (count: number): Target[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `target-${index}`,
      label: `Target ${index}`,
    }));

  assert.deepEqual(
    searchTargets(makeTargets(9), "").map((result) => result.hint),
    ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
  );
  assert.deepEqual(
    searchTargets(makeTargets(10), "").map((result) => result.hint),
    ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"],
  );
});

test("hidden targets do not consume hints", () => {
  const results = searchTargets(
    [
      { id: "first", label: "Open First" },
      { id: "hidden", label: "Open Hidden", hidden: true },
      { id: "second", label: "Open Second" },
    ],
    "open",
  );

  assert.deepEqual(
    results.map((result) => [result.target.id, result.hint]),
    [
      ["first", "1"],
      ["second", "2"],
    ],
  );
});

test("assigns no hints to an empty result", () => {
  assert.deepEqual(assignHints([]), []);
});
