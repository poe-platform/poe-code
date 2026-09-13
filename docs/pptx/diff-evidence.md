# Deterministic presentation comparison evidence

This receipt concerns the original F59 comparison operation. It does not claim
visual equivalence or whole-public-model parity. Procedures and execution
receipts belong in [the comparison plan](../plans/pptx-diff.md).

## Inventory reconciliation

The complete pinned [test inventory](upstream-test-inventory.json) was parsed:
2,700 collected unit variants and 973 expanded BDD examples. The complete
[public API inventory](upstream-api-inventory.json) contains 2,407 records,
including inherited members, enum values, collections, helpers, constructors and
public types whose names begin with an underscore. There is no public `diff`
member and no comparison-operation BDD scenario in these inventories. The unit
name containing “different” concerns cell ownership across tables, not document
comparison. F59 is an original extension rather than a source API port.

No source row is deleted, merged, reclassified as private or upgraded to passing
by this work. Every individual source parameter/example remains accounted for in
[the full case ledger](test-case-map.json). Its exact original design,
parameter binding, provenance and current implementation disposition continue to
apply. [The API register](public-api-map.json) retains public-member obligations,
including APIs without source tests. No extra diff source-case ledger is needed:
there are zero source comparison-operation cases to adapt.

Comparison reuses bounded observations already exposed by the package: ordered
slides, shape identities and geometry, text, properties, media bytes,
relationships and supported formatting resolution. These observations do not
implement the model accessors or mutations exercised by neighboring source
cases. For example, the pinned suites contain 76 slide cases, 19 presentation
cases, 35 core-property-part cases, 32 image-part cases, 2 media-part cases,
92 OPC-package cases, 74 base-shape cases and 184 text-object cases. These are
separate rows, not a many-to-one parity claim for a comparison assertion.
Chart/style/layout inheritance, creating getters, cropping setters, collection
protocols and compatibility image SHA-1 retain their own acceptance obligations.
Unsupported chart or extension bytes can be detected as changed opaque data
without completing any of their editable/model APIs.

The historical “adaptation not started” test-audit wording is a pinned research
checkpoint; later bounded receipts describe actual TypeScript progress. This
receipt adds no whole-package completion claim. Reference provenance remains in
research only. The authored regression fixtures do not copy source assets or
implementation; existing required standalone license notices remain applicable
and unchanged.

## JavaScript and security mapping

- Comparison is an operation surface, not a renaming of neutral model methods.
  Mode/options use the shared camelCase operation contract. Model spellings,
  enums, inherited properties and returned types retain their separate register.
- Both inputs are explicitly admitted presentation data under the existing
  context/limits. There is no implicit host path, download, native application,
  embedded-object activation, font search, external-link fetch or wall-clock
  dependency. Read-only comparison must not invoke creating model getters.
- Equality is a Boolean data field. A successful differing result is not an SDK
  exception. CLI mapping is 0 equal, 1 different, 2 comparison failure and 130
  cancellation; detailed typed errors remain available independently of exit
  status. Successful differences retain `ok: true` in the common envelope.
- Media integrity uses SHA-256 over original bytes, not decoding, rendering or
  the separate documented image SHA-1 compatibility property. Part location and
  content identity are distinct observations.
- Ordered sequences and stable IDs express positions and identity separately.
  Replacement and movement must not collapse into the same positional zip of
  slide arrays. Numeric geometry remains bounded exact EMU data, not pixels.
- Raw comparison observes package markup/bytes. The requested
  `effective-formatting` mode is explicitly rejected with `unsupported-profile`
  because complete effective formatting comparison is unavailable; capabilities
  reports that rejection. No partial resolver comparison is labeled equality.
  Structural results explicitly declare raw formatting. Missing, false and
  explicit values remain separate model obligations.
- Unsupported opaque bytes remain visible comparison data. Detecting a hash
  change is not evidence of a semantic interpretation, safe execution or edit
  support. Difference ordering must be deterministic without locale-dependent
  comparison.

## Original acceptance

Original authored acceptance resides in:

- `packages/pptx/src/diff.test.ts`: equality data; effective-mode rejection;
  reorder versus identity replacement; literal text/property/geometry changes;
  independent Node SHA-256 expectations for opaque media; raw/unsupported part
  changes; relationship target changes; pre-admission validation, cancellation
  and byte ceilings.
- `packages/pptx/src/command-diff.test.ts`: successful equal/different envelopes;
  comparison trouble for malformed/missing inputs and limits; invalid options
  before I/O; executable schema/help/capabilities; cancellation and output bounds.
- `packages/safe-bash/tests/commands/pptx/diff.test.ts`: quoted shell scripts,
  Unicode text, stdin, equality/difference/trouble statuses, SDK result parity
  and unchanged input bytes; final executed scope is recorded in the plan.

These use original in-memory packages and memfs, not corpus downloads. Literal
before/after values and an independent hash implementation avoid using the
comparison result as its own oracle. Source case names/assets do not appear in
these product tests. The coordinating owner records actual maintained checks
and results in the plan; a test reference alone is not a passing-run receipt.

Independent review identified a text-mode order defect: keyed segment equality
could miss a reordered reading sequence. The engine owner reproduced this with an original failing regression, then
added the stable `text/order` record. Eight focused engine cases passed after
the fix. Semantic identity checks also confirm slide-part renaming preserves
slide/text/geometry observations while raw comparison reports the rename. Raw
structural fallback intentionally continues to report renamed or reserialized
parts, and media mode compares byte-hash multiplicity rather than names.
