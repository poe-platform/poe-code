# Initial public API closure checkpoint

This receipt predates the owner, chart, layout, run-hyperlink and enum work in
this task. Its counts and missing-member findings below are historical. See
[the central register](public-api-map.json), [later owner mappings](model-owner-api-reconciliation.md)
and [integrated verification](public-closure-verification.md) for current evidence.

The register is **not closed**. All 2,409 reconciled inventory identities remain
inside the 2,426 target rows; the extra 17 bounded-view rows remain additive.
The 2,700 unit and 973 expanded BDD baseline cases remain separate obligations.
Neither the available export count nor passing package tests supplies a smaller
coverage denominator.

| Current assessment                   |  Rows | Meaning                                                                                                                           |
| ------------------------------------ | ----: | --------------------------------------------------------------------------------------------------------------------------------- |
| Bounded SDK receipts                 |     7 | Five presentation boundary rows reviewed here, plus two previously recorded freeform offset rows rechecked here                   |
| Confirmed unsupported public members |     9 | Actual missing members listed below; each blocks full coverage                                                                    |
| Not currently reconciled             | 2,410 | Historical proposed rows requiring member-specific export, behavior and command evidence; this is not a claim that all are absent |
| Total                                | 2,426 | All rows retained, including 160 rows involving underscore-prefixed public types                                                  |

The explicit lists and partition rule are in
`public-api-map.json.current_review.whole_denominator_assessment`. Every remaining
row retains its planned cases, getter/setter signatures, errors, effects,
inheritance/source declarations, candidate test groups and CLI obligations.
Missing upstream tests do not waive original tests. No name-only match against
exports promotes a row; no underscore-prefixed type is reclassified as private.

## Reconciled presentation boundary

The actual root export is the async `Presentation` factory returning the exported
`PresentationModel` interface. The old register's `Promise<Presentation>` and
`interface Presentation` were proposed names, not the current declarations. The
catalog and these exact rows now reflect the actual public type. This correction
does not claim that the interface supplies the complete documented object graph.

| Member                           | Actual behavior and original evidence                                                                                             | Command counterpart                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Presentation(input?, context?)` | Always a Promise; owned bytes, explicit read capabilities, deterministic original creation, cancellation and typed input failures | `create`; existing-input admission occurs in document-consuming operations                                      |
| `core_properties`                | Cached synchronous live view; creates a missing property part; title survives save/reopen                                         | `properties list/get/set`; reads remain noncreating                                                             |
| `slide_width`, `slide_height`    | Nullable `Length` reads, validated synchronous assignment through the same guarded canvas engine                                  | `settings get/set`, `--width`, `--height`                                                                       |
| `save(destination?)`             | Always async; owned byte result or explicit byte sink/publication capability; stale state and cancellation reject publication     | Shared validated mutation/create/batch publication; no standalone proposed object-method dispatch is registered |

Original evidence: `packages/pptx/src/presentation-model.test.ts`,
`presentation-public-exports.test.ts`, `creation.test.ts`,
`command-settings.test.ts` and `command-metadata.test.ts` in the same directory.
The register identifies these as bounded SDK implementation evidence. Historical
planned acceptance cases remain visible and are **not** all marked as passed.
All five rows retain `full_member_closure: false`; command counterparts do not
certify every returned-object behavior. In particular, the creation-on-access
getter and standalone save semantics are not arbitrary typed member invocations.
The two freeform offset rows still have proposed, unregistered command routes.

## Exact JavaScript and security differences

- J01/J06: `Presentation(input?: BinaryInput | null, context?: PresentationContext)`
  returns `Promise<PresentationModel>`. Null or undefined input creates. Inputs are
  `Uint8Array`, explicit byte source, or VFS read capability; a raw host path does
  not grant authority. The model has no native runtime, implicit network or host
  discovery requirement.
- J06/J07: original model creation is an empty 10 × 7.5 inch presentation. The
  existing lower-level creation/CLI default is wide. Explicit CLI `--width 10in
--height 7.5in` supplies the model dimensions. Author defaults to an empty
  string; timestamps are absent unless supplied. Context dates are snapshotted
  before awaiting. Empty original creation does not imply a stock layout graph.
- J02/J05: dimensions are immutable `Length` values in the model and integer EMUs
  in operation results. Setters require a `Length` in the supported 1–56 inch
  edit range; null and numeric primitives are not assignments. Absent size reads
  null without mutation. Setting one model axis when size is absent supplies the
  original companion dimension; the command requires an explicit complete pair.
- J02/J07: `core_properties` can create a missing part. CLI property reads avoid
  that getter's side effect. This receipt tests boundary access and representative
  title/default metadata, not every returned `CoreProperties` member.
- J06: `save()`/`save(undefined)` returns `Promise<Uint8Array>`;
  `save(ByteSink | PresentationPublication)` returns `Promise<void>`. The
  destination parameter is optional, unlike the old proposed `file: BinaryOutput`
  declaration. Both overloads are always async. Null and raw strings fail with
  `invalid-type`. The explicit publication callback receives the shared request
  and cancellation signal, must perform atomic destination/source checks, and
  advances the in-place baseline on success. A byte sink is transport and has no
  rollback guarantee; the caller owns sink closure. Model changes while
  serializing reject before publication with `stale-selection`.
- J10: common command paths, JSON operation IDs, publication flags, envelopes and
  status codes remain those in the shared contracts. The old invented
  `slides.presentation.presentation.*` operations are preserved as historical
  proposals, separately from real routes. No dynamic method dispatch is implied.

## Confirmed missing public roots

The current `PresentationModel`/`LivePresentation` definitions do not provide
`equals` (the mapped `__eq__`), `notes_master`, `slide_layouts`, `slide_master` or
`slide_masters`. `Slide` does not provide `has_notes_slide`, `notes_slide` or
`slide_layout`; `Slides` does not provide `add_slide`. These nine register rows
now explicitly say `unsupported`. They remain public requirements. Existing
low-level notes/layout/master/slide operations do not supply their missing live
model ownership, creating accessors or return contracts.

The integration owner also instantiated the built public factory and confirmed
missing `slide_layouts`, `slide_masters` and `slides.add_slide`. Available runtime
exports (272) and declaration exports (516) describe package surface size.
An exact-name comparison found 84 catalog mismatches, but aliases and returned
interfaces prevent treating those mismatches as 84 unsupported APIs. Only the
members inspected above receive a fresh unsupported classification here.

The remaining 2,410 rows need reconciliation against actual acquisition paths,
exports, every original observable case and executable CLI schemas. Whole guide
workflow execution and remaining chart/text/drawing/collection/enum/helper rows
are not certified by this receipt. Historical receipts can guide that review but
cannot replace its denominator or turn planned case descriptions into passes.

## Executed checks

Focused command:

```sh
npx vitest run packages/pptx/src/presentation-model.test.ts packages/pptx/src/presentation-public-exports.test.ts packages/pptx/src/command-settings.test.ts packages/pptx/src/command-metadata.test.ts packages/pptx/src/creation.test.ts packages/pptx/src/freeform-builder.test.ts
```

Result: 6 files, 85 tests passed, 2.53 seconds. Tests use original small data and
memfs where filesystem behavior is exercised; no publisher decks or reference
runtime is a test dependency. The freeform suite rechecks the two existing offset
receipts without promoting their proposed CLI paths.

The integration owner reports maintained PPTX unit checks passing 261 files /
6,838 tests, package lint and maintained PPTX build closure passing, and 239
safe-bash PPTX integration tests passing. These are local execution results, not
release evidence, public-API completeness or a packed-consumer certification.
