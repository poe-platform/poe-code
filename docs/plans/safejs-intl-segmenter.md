# Intl.Segmenter

## Validated missing behavior

On September 8, the built PluralRules candidate rejects this program with
`Segmenter is not a constructor` on Node 18.18.0, Node 22.23.2 and Node 24.14.0:

```js
return [...new Intl.Segmenter('en', { granularity: 'grapheme' })
  .segment('A👨‍👩‍👧‍👦é')];
```

Native controls on all three versions return three segments, with UTF-16 indices
0, 1 and 12. The missing API is confirmed; other behaviors still need failing
tests before implementation.

## Required implementation

- Constructor, locale/options conversion order, supportedLocalesOf,
  resolvedOptions, strict receiver brands, descriptors and subclassing.
- Grapheme, word and sentence segmentation; containing uses UTF-16 offsets,
  including offsets inside surrogate pairs and combining sequences.
- Segments objects must be reusable iterables, not eagerly substituted arrays.
  Each iterator has its own position and inherits the guest iterator prototype.
- Guest-owned private state for the segmenter, segments and iterator; strict
  snapshot validation, identity/custom-property preservation and replay from
  partially consumed iterators. Do not serialize a native iterator closure.
- Retained-data accounting must include private input strings and segmenter
  references even after guest prototype changes. Charge input/scan/output work;
  avoid an unmetered eager segmentation of arbitrarily large input.
- Capture native methods privately and verify behavior on supported Node
  versions. Unicode/ICU version differences are not automatically runtime bugs.

The [ECMA-402 iterator algorithms](https://tc39.es/ecma402/#sec-segment-iterator-objects)
retain the segmenter, input string and next UTF-16 boundary. A restored cursor
must be checked against the input and segmentation boundaries, not merely
accepted as an arbitrary integer. Completed iterators remain branded.

## Verification and delivery

Write failing tests after the active PluralRules full-suite source freeze ends.
Cover native differential cases, missing arguments, coercion errors, aliases,
private-state budgets, forged snapshots and repeated continuation. Run focused
lint/tests and the maintained workspace build, then built probes on Node 18 and
Node 24. Deliver this independently from PluralRules and monitor publication
without delaying the next validated gap.

## Implementation progress

- Twenty native comparisons failed at the missing-constructor guard, then passed
  with the guest constructor, segments objects and independent iterators.
- Three repeated-snapshot tests then failed because private brands were lost;
  two retained-input tests measured only one unit instead of the hidden string.
  Snapshot kinds and private-state accounting now make all 25 cases pass.
- Typecheck passed after representing segment output and resolved options as
  serializable plain data types. Native segmentation state stays private.
- Broader compatibility checks exposed a direct Intl test setup lacking the
  shared iterator prototype and two legacy inventories lacking Segmenter.
  Their setup/addition lists were updated without changing the legacy fixtures.
- The four-file focused regression now passes 92 tests, with one existing skip.
  It includes forged options/references/input/cursors, public pending/completed
  replay, long-input budgets and private prototype/method mutation accounting.
- The maintained workspace build passed 23 workspace builds and four fresh
  import checks. Initial lint passed all 11 changed implementation/test files;
  the final two modified test files are being checked again.
- Built probes on Node 18.18.0 and Node 24.14.0 each passed 45 combinations of
  locale, granularity and text, comparing both iteration and containing with
  native controls. Both versions also passed checkpoint replay.
- The broader snapshot-directory regression passed 1,492 tests across 90 files.
- A final built probe exposed incorrect structuredClone acceptance for all
  three new object types. Three failing regressions preceded the private-brand
  rejection fix. The subsequent clone/Segmenter regression passed 155 tests
  across nine files; final affected-file lint and the maintained build passed.
- A follow-up probe also confirmed this clone gap for eight existing Intl
  constructors; their separate fix is tracked in safejs-intl-structured-clone.md.
- This plan accompanies the separate Segmenter commit. Remote-main delivery and
  publication must be verified after its push. The preceding PluralRules
  addition published as 0.1.463.
