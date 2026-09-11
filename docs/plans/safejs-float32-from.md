---
title: Float32Array.from factory
---

# Validate and implement the inherited typed-array from factory

Earlier native/SafeJS probes confirmed that Float32Array.from is missing. The
new native-oracle suite covers arrays, array-like objects, strings, subclass
construction, mapper receiver/index and the distinct iterable versus array-like
ordering of collection, construction and mapping. No implementation changes
have been made for this factory yet.

Follow the ECMAScript TypedArray.from algorithm through existing guest iterator,
construction, property access and numeric-coercion mechanisms. Validate receiver,
mapper and returned storage in the specified order. Preserve budget accounting,
iterator failures, portable intrinsic identity and pending-effect replay. Add
negative and retained-value tests before qualifying the implementation. The
related array-like constructor input support, other typed arrays, buffers and
species behavior remain separate incomplete work.

The contextual-of parser fix is committed as 25fd8fdf6; verify its remote delivery
and releases independently while working here. Float32Array.of is already
published as @poe-platform/safe-js@0.1.309, but its CLI workflow remains monitored.

All seven initial native-oracle cases fail in current SafeJS, confirming the
missing factory before implementation: `/tmp/poe-safejs-float32-from-red.log`.
The parser commit is verified on remote main at
25fd8fdf60765a3084ff7c18c9f44003d0290c05. Its current release runs are CLI
34086222555 and scoped packages 34086222335. The preceding factory CLI run
34085616481 was cancelled by the newer push, so it is not a CLI publication
receipt; the scoped 0.1.309 publication is confirmed independently.

## Implementation and qualification in progress

The shared TypedArray constructor now owns `from` with native method metadata.
The iterable route collects before construction/mapping; array-like input reads
length, constructs validated typed storage, then gets/maps/converts each index.
All operations use guest invocation/coercion, bounded collection allocation and
retained-value accounting. The initial seven failures passed after implementation;
17 expanded native comparisons then passed, covering validation order, abrupt
iteration/mapping and null iterator fallbacks.

Two-round snapshots preserve factory identity and mapped subclass results.
Retention tests verify collected 10KB items survive iteration/mapping and release
on success/throw; an allocation-boundary test verifies no construction or mapping
before an oversized collection is rejected. Two direct-call tests exposed skipped
guest accessors and a legacy generator returned by an iterator getter. The factory
now supplies a guest property/call bridge when needed; iterator acquisition routes
only prototype-less legacy synchronous generators without an own next descriptor
through the existing legacy adapter. Explicitly detached modern generators remain
rejected, with a native-oracle control.

The four-file factory/generator cohort passed 128 tests and TypeScript passed.
Log: `/tmp/poe-safejs-float32-from-direct-final.log`. The subsequent detached-control
cohort is at `/tmp/poe-safejs-float32-from-control.log`. Full SafeJS qualification
is running at `/tmp/poe-safejs-float32-from-package.log`, excluding only the separate
two-case host-Promise policy audit. This is uncommitted local implementation;
final lint, build, real harness/screenshot and atomic push remain to be completed.

Scoped final lint passed. The full-suite process remains live (session 88783).
The preceding contextual-of parser fix is confirmed published as
@poe-platform/safe-js@0.1.310, receipt from run 34086222335 at
2026-09-07T05:21:20.9897917Z. Its CLI run 34086222555 remains monitored separately.

## Qualified delivery

The full SafeJS suite passed 17,734 tests with 41 skips (520 passing files,
one skipped) in 240.52 seconds, with only the separate two-case host-Promise
policy audit excluded. Scoped lint and TypeScript passed. The selected build
passed its 23-workspace closure and all four native-ESM checks. The real harness
passed after 70 uncached CLI build tasks (59.352 seconds); its screenshot was
opened and visually verified at
`screenshots/harness-run-docs-plans-safejs-float32-from.md.png`.

No matching open GitHub issue was found. This factory is ready for atomic
commit/push; remote delivery and actual publication must be checked separately.
The next constructor-input probes reproduced array-like/custom iterable rejection
and ignored array iterator overrides; see `safejs-float32-constructor-inputs.md`.
