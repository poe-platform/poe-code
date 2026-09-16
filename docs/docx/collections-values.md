# DOCX collections and values evidence

Scope: `sdk-collections-values`, local main only. The pinned inventories and
1,337-row public API research register retain their original denominators. This
record qualifies the verified subset; it does not establish whole-model coverage.
The [owned plan and agent QA procedure](../plans/docx-collections-values.md)
records sequencing, ownership and final delivery.

## Enum surface

The existing immutable enum transport records now have readonly numeric values,
neutral stringification and XML metadata. Families provide checked `fromValue`,
retained `from_xml`/`to_xml`, immutable `.members` and canonical JS iteration.
All 19 canonical families and 262 documented named values are represented;
`TEXT_WRAPPING` aliases the same member as `LINE_CLEAR_ALL`, so canonical iteration
has 261 values. Eleven documented family aliases remain exact family identity.
The header/footer constructor enum and alias remain visible.

Original acceptance is in `public-enum-protocols.test.ts`: nine independently
authored domain tables assert numeric/XML facts for the newly added families;
the remaining ten families exercise every named member's immutable value,
stringification, lookup, JSON and validation protocols. Independent read-only
review compared every numeric/XML entry against the pin with no mismatches.
The [exact value map](collections-values-map.json) links every named value.
The collected upstream suite has no equivalent full enum protocol unit coverage;
these original tests cover documented members even without upstream unit tests.

## Exact JS and security mappings

- Enum symbols remain typed by family. Identical integers in different families
  remain distinct; numeric coercion fails. Numeric lookup rejects noninteger,
  nonnumeric and unknown values with TypeError/RangeError. No dynamic enum class
  creation or arbitrary method invocation is admitted.
- Enumerable JSON remains exactly `{enum, name}`. Trusted SDK symbols have frozen,
  nonenumerable metadata/methods and enter validation through a private WeakSet.
  Arbitrary executable transport records, getters and inherited prototype-family
  names reject before caller getters run. No I/O, time or authority is acquired.
- Direct `.members` is a frozen readonly name-to-member **record**, deliberately
  replacing the research register's proposed ReadonlyMap. JS `Map` freezing does
  not freeze its entries. The record permits alias lookup without exposing mutable
  backing storage. Batch `.members` retains the existing `{key,value}[]` encoding;
  batch iteration emits canonical typed records once, in declaration order.
- D04: no `MIXED` member is invented. Source `INHERITED` is retained. Direct family
  `to_xml(INHERITED)` returns null; `from_xml(null)` resolves documented inherited
  values. The earlier extra helper `enumXml` intentionally remains string-only
  and rejects null representations; it is not the retained family conversion.
  `UNMAPPED` is not an admitted XML value. Non-XML families and sentinel conversions
  fail, while their XML metadata is absent/null as appropriate.
- Neutral source method spellings stay primary. Existing versioned advanced batch
  IDs/options stay unchanged and use typed receivers/arguments. Source class-level
  `to_xml` maps directly to the family method; the existing batch contract selects
  that family with a typed enum receiver. Alias family exports use canonical
  batch operation IDs. No parallel editor is introduced.

## Verification

Initial red: twelve new tests failed on missing families/protocols/batch routes.
Later original reds reproduced omitted `TEXT_WRAPPING` batch support, alias schema
rejection, getter execution and inherited prototype-family acceptance. Each was
fixed only after concrete failing evidence. A mistaken initial style-count
expectation (125) was corrected to the pinned 132; it was a test-authoring error,
not a product defect. A maintained run that overlapped newly added red tests failed
two cases and is not a verification receipt.

Final focused enum candidate: four files / 38 passed, including 18 new tests.
Fresh maintained checks and local hashes are recorded in the plan after completion.
CLI original memfs acceptance emitted one pure JSON envelope, exit 0, affected 0,
unchanged input, no diagnostics and no publication. Actual human CLI batch output
was `docx batch: 2 operations; 0 changes`; the maintained general screenshot route
captured it in `screenshots/cat-tmp-docx-enums-batch.txt.png`. Visual inspection
confirmed complete readable output with no clipping. DOCX is an optional command
engine; the root-only screenshot-poe-code route is not its launcher.

Ad hoc QA mistakes (CJS evaluation of ESM exports, missing engine options, wrong
limit shape and unsupported per-model help path) are not product regressions or
passing checks. The mistaken root screenshot build was cancelled. No native
reference runtime, asset acquisition, README edits, fixture cleanup, push or release.

## Remaining live-owner prerequisites

The earlier live-object task's own evidence still lists absent Document,
paragraph/run, table, section/story, comment and general package owners. In
particular `_Rows`, `_Columns`, Sections, InlineShapes, Comments, ImageParts and
Relationships are not live public collections. Their documented numeric/slice,
sparse ID-keyed, ownership, mutation and inherited member obligations remain
pending. Utility arrays and relationship graph snapshots cannot count as those
collections. This task extends the existing live types and must not create a
second editor or placeholder wrappers to conceal the missing prerequisites.
Later tasks remain pending.

## Verified live collection and value increment

Original memfs acceptance in `collection-value-protocols.test.ts` qualifies the
existing TabStops/TabStop, keyed Styles/LatentStyles and immutable RGB/Length
surfaces. It does not fabricate missing collection owners.

| Protocol          | Exact supported JS behavior                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Numeric lookup    | RGB and TabStops use readonly numeric lookup and `.at`; zero is a value, not absence. Invalid fractional/nonfinite/unsafe indexes reject; out-of-range indexes throw BoundsError. Established signed bracket compatibility is retained alongside primary `.at`.                                                                                                                                                                             |
| Iteration         | RGB yields channels in order; `.reversed()` returns a real iterable iterator. Tab iteration snapshots membership when traversal starts; insertion/movement cannot duplicate or introduce members into that traversal.                                                                                                                                                                                                                       |
| Slicing           | RGB tuple slicing uses signed, clamped, half-open bounds and rejects noninteger bounds. TabStops does not gain slicing. Sections/\_Rows slicing remains a missing-owner obligation.                                                                                                                                                                                                                                                         |
| Mutation          | Tab removal uses `.remove(index)` and supports signed indexing. The earlier `.delete` spelling remains the identical function, without a forwarding wrapper. Numeric writes, deletion and definition reject. Removed node handles reject property, XML, part and equality access.                                                                                                                                                           |
| Shared live views | Repeated paragraph formatting views reuse one existing tab collection by stable owner identity. Inserting or moving through a second view retains the first view's handles and owner/node equality. No second store or editor is created.                                                                                                                                                                                                   |
| Keyed lookup      | Styles/latent styles retain string names, deprecated defined-style ID fallback and traversal order. Sparse IDs `Slot0`/`Slot99` remain IDs; numeric ordinal aliases reject. Missing throwing lookups use MissingKeyError; declared nullable/default lookups retain null/default.                                                                                                                                                            |
| Values            | Defined and inherited null, explicit false and numeric zero remain distinct. RGB tuples and helper values are immutable; hex input requires six ASCII digits, accepts either case, emits uppercase and rejects coercion/whitespace/prefixes.                                                                                                                                                                                                |
| Units             | All seven DOCX helpers retain exact safe integer EMUs and six accessors. Halfway rounding is away from zero, including negative values; unsafe/nonfinite/nonnumeric input rejects. No centipoint helper is documented for DOCX.                                                                                                                                                                                                             |
| Errors            | Numeric selection misses use BoundsError (`missing-selection`); keyed misses use MissingKeyError (same code); removed handles use StaleHandleError (`stale-selection`). A tuple value-search miss is a source ValueError, so RGB `.index` uses InvalidValueError (`usage`), not a bounds error. Invalid enum/helper inputs use existing InputTypeError/InvalidValueError, preserving TypeError/RangeError inheritance and CLI usage exit 2. |
| Batch/CLI         | Existing typed operations expose tuple/reverse results as bounded arrays. Only the known RGB reverse action materializes its iterator; arbitrary generators are not admitted by generic encoding. Missing numeric targets produce exit 1, invalid enum values exit 2, null failure data, affected 0 and unchanged input.                                                                                                                    |

D06 string-key lookup, D15 unit rounding, D20 strict RGB parsing, D22 nullable
latent overrides and D23 current tab owner/node semantics have original cases.
The tests preserve the D15 deliberate differences: Cm(2.53) is 910800 EMUs and
Emu(9144.9) is 9145, rather than source truncation/float artifacts. Existing tests
still qualify all unit accessors and inherited helper types; new boundary cases
add unsafe values, zero and negative halfway conversions.

Initial collection red: six of nine cases failed. Further separate reds exposed
reverse iterator shape, invalid numeric properties, stale metadata, shared-view
token invalidation, generator transport cloning and incorrect enum error exit.
The initial new expectation banning all signed brackets was an overinterpretation
of the mapping; it contradicted an established original test and was corrected
without changing that existing test. Out-of-range signed lookups still reject.
Final focused candidate passed eight files / 134 tests, including 21 new cases.
The first lint attempt exposed two test-only unchecked-index annotations; these
were corrected without weakening runtime assertions.

The human CLI missing-target check returned exit 1 and emitted only
`docx: Document operation failed: missing-selection`. Its inspected screenshot,
`screenshots/cat-tmp-docx-collections-error.txt.png`, is complete and readable,
with no document content in diagnostics. Screenshot artifacts remain disposable.
Independent final review approved shared-view state, error mappings and numeric
mutation protections. Final maintained receipts and local delivery are in the plan.

An actual public export prerequisite probe returned `ok: false` and exit 1 for
the eight missing owner/factory exports listed above. That failure is retained in
the exact map as missing prerequisite evidence; it is not an expected-failure pass
or a reason to classify public underscore types as private. This task remains open
for those live collections, sparse comment IDs and general relationship mutations.
