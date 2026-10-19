# Pounce core specification

Pounce ranks plain-data targets for a typed keyboard query and assigns each
returned target a short numeric hint. The core library does not depend on the
DOM or browser APIs.

## Target data

Each target has a stable `id`, a display `label`, and ranking metadata:
`primaryAction`, `usageCount`, `proximity`, `hidden`, and its original input
order. Labels and queries are trimmed, whitespace-collapsed, and matched
case-insensitively.

## Ranking

For a non-empty query, hidden targets are excluded. Visible matches are ranked
by these keys, in order:

1. Match tier: exact label/token, word prefix, substring, then fuzzy.
2. Primary action: primary targets first.
3. Usage history: higher pick count first.
4. Proximity: lower value first.
5. Stable original input order.

An empty or whitespace-only query returns all targets, including hidden ones,
using the same deterministic metadata ordering after match tier. A query with
no visible matches returns an empty list.

## Hints

Hints are assigned after filtering and ranking, in display order. They are
unique, contiguous, numeric strings, and prefix-free within one result set.
They use the smallest fixed width needed for the result count (`1`–`9`, then
`01`–`10`, and so on). Hidden targets never consume a hint.

## Public behavior

The library exposes pure functions for ranking targets, assigning hints, and
combining both operations. Inputs are not mutated, and identical inputs
produce identical outputs.
