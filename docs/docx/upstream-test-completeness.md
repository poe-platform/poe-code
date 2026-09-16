# DOCX complete inventory reconciliation

Research date: 2026-09-15. The [row receipt](upstream-test-completeness.json)
reconciles every pinned unit variant and expanded BDD identity with the historical
[crosswalk](test-case-map.json), scoped adaptation records and
[actual original TS results](original-test-results-20260915.json). This is complete
accounting with open acceptance gaps, not a parity or OOXML conformance claim.
The [owned plan](../plans/docx-upstream-test-completeness.md) contains the QA
procedure. Later tasks remain pending.

| Accounting category                                                   |  Rows |
| --------------------------------------------------------------------- | ----: |
| Dedicated observable adaptation with matched fresh results            |    31 |
| Bounded named evidence; exact variant/public workflow acceptance open | 1,053 |
| Scoped record without a named execution link                          |   698 |
| No recorded original adaptation                                       |   477 |
| Total pinned unit/BDD rows                                            | 2,259 |

There are zero missing, duplicate or orphan identities and zero exclusions.
The 1,782 rows with scoped records include pending records; they are not 1,782
passing adaptations. Only 1,084 rows have matched named original execution
crosslinks, and those crosslinks retain their stated qualification boundaries.
Fresh maintained DOCX tests passed 3,375 cases in 171 files; shared office-package
tests passed 46 cases in two files. No failures, pending cases or TODOs occurred.
Both maintained scoped lint routes passed; DOCX retains one type-only
unused-variable warning. Nested describe counts are not file counts. These are
new execution receipts, not a silent rewrite of the earlier 3,374/170 summary.

## Evidence interpretation

The acquisition inventory's `unmapped_not_implemented` and the historical map's
empty red/green fields remain provenance. They are superseded only where scoped
supplements provide evidence, not by the total number of passing package tests.
The original map's proposed `packages/docx/tests` titles are historical
destinations; actual original tests primarily live in `packages/docx/src`.
Their absence does not erase existing adaptations. Conversely, a present test
file or passing family matrix does not establish an exact variant assertion.

Each receipt row links the complete semantic witness, bound parameters or
expanded steps, owning task, scoped records and matching actual results. Its
remaining obligation stays visible even when adjacent or bounded tests pass.
Missing and composite test titles are reported and resolved to concrete original
test crosslinks where possible; pattern expansion is crosslink evidence only.
The 22 XML sequence labels specifically resolve Vitest's quoted parameter titles
to the same recorded labels. No source-variant assertion is inferred from quoting.
Many-to-one cases retain the scoped equivalence and per-row witnesses. No row
is excluded or counted as passing merely because it tests private allocation,
has an underscore-prefixed owner, or lacks an implementation destination.

The nine URI and 22 ordered XML cases have dedicated observable mappings.
Readonly children plus explicit selection and validated editor mutation replace
dependency-specific child dispatch. URI values use checked immutable strings,
not host paths or a String subclass. These substitutions concern architecture;
general package/XML owners and their mutation authority remain separate.

Style/formatting matrices cover raw absence, false, explicit values, signed/zero
lengths, enum sentinels, keyed lookup and live invalidation. Some associated
Document/Paragraph/Run/Table owner bindings remain explicitly pending. Image
records distinguish bounded headers/admitted metadata from live ImagePart and
InlineShape owners. Table utility observations retain merge geometry, order,
omissions and owner aliasing while live table return values/collections and
complete BDD workflows remain pending. None of these boundaries is a blanket
architecture exclusion.

## Shared contracts and documentation drift

The [CLI contract](../specs/office-cli.md) governs plural `images`, `tables`,
`properties`, preserving `text replace`, common flags, lower-only limits,
one-based scoped selectors, fingerprinted locations and version 1 envelopes.
Ordinary exits are 0/1/2/3/4/130; diff uses 0 equal, 1 different, 2 failure,
130 cancellation. Schema/capabilities are discovery evidence, not execution of
pending members. Paired cross-format runtime QA belongs to a later task.

The [SDK contract](../specs/office-sdk.md) retains neutral snake_case model
spellings and source positional order. Admission/publication are always async;
admitted model access is synchronous. Typed trailing options, zero-based sequences
and explicit supported at/slice protocols, keyed styles/relationships, nullable
lookups, copied UTC Date/Uint8Array values, checked integer EMUs and half-away
rounding remain distinct. Explicit VFS/time/identity and owner-bound XML/package
views replace ambient authority. No arbitrary XPath/evaluation, document callback,
external relationship activation or host font discovery is promised.

The receipt retains all 920 inventory IDs and 1,337 API-map rows, including 417
inherited rows, enum values/aliases, collections, helpers and untested APIs.
Per-row signatures, effects, exceptions, routes and `M-*` rules link to the
[API map](public-api-map.json); the eight documentation-error rows remain visible
and create no aliases. Planned, language-mapped and security-mapped are not
implementation statuses. Whole-public-API acceptance remains open.

All 23 D01–D23 decisions remain separately linked. Additional research drift is
resolved as follows:

- BaseStyle name/style_id and applicable inherited copies are nullable read/write,
  as the scoped source audit and original tests establish. The old nonnullable
  proposed acceptance wording is historical, not the current target contract.
- Enum protocol helpers are explicit immutable operations, not executable
  metadata properties. Checked Length values do not promise implicit integer
  inheritance or arbitrary coercion. Bounded snapshots do not promise a complete
  mutable dependency XML API.
- PNG pixels-per-metre convert without rounding: 1654/945 gives 42.0116/24.003
  DPI. BMP 7864/0 gives header 199.7456/null and native fallback 199.7456/72.
  Missing axes default independently to 72; height uses vertical DPI and scaling
  uses unrounded physical aspect before checked final EMU rounding. These are
  intentional target differences, not literal numerical parity.
- Comment identity/date aliases, obsolete table direction/style spellings and
  enum typos remain documentation errors. AUTO highlight serializes `default`;
  null removes highlight. Utility JSON snapshots do not stand for live owners.
- Historical phrases saying no TS tests were written apply to the named research
  milestone. Current scoped and fresh results establish bounded implementations;
  they do not change historical baseline execution or complete the model.

## Original supplemental evidence

The receipt names fresh passing original security, preservation and profile cases
and their invariants. Independently authored ZIP headers/CRCs, encoded paths,
DTD/entity rejection, inert links/fields, actual expansion limits, cumulative
budgets, cancellation and failure-before-publication exceed upstream coverage.
Memfs sentinel/input equality and exact unaffected part bytes provide preservation
evidence. These tests require neither downloaded documents nor a reference clone.

[Large-file measurements](performance-measurements.json) and the
[performance report](performance.md) remain opt-in historical qualification,
separate from small fast profile regressions. They record original stored-binary
20/100 MiB regimes, 40 MiB XML, explicit trusted profiles and SDK/Shell targeted
edits. Default rejection and successful explicit-profile retries are different
results. Repeated all-match edits show superlinear work and a retained-budget
failure; the small eight-run regression proves read success and unpublished
failure at the same 500-node ceiling. No linear-scaling guarantee or new large
campaign is claimed here.

The [crosslinked counterpart audit](../pptx/upstream-test-audit.md) supplies shared
URI/relationship/content-type/image semantic comparison. Its 2,700 unit and 973
BDD cases remain separate denominators. Pillow/WMF paths are not identical to
bounded DOCX header characterization. Neither historical source-suite percentages
nor current V8 coverage establishes OOXML conformance, rendering fidelity or
capability-safe publication across every public API.

## Provenance and limits

Input, source and raw execution hashes are retained in the JSON receipts.
The checked candidate includes preexisting uncommitted packing/discovery changes;
fresh passes are live-worktree results, not committed or published qualification.
The source snapshot was captured during execution and checked again afterward.
Historical missing native raw artifacts remain unverifiable; no native/reference
unit/BDD suite was rerun. No source or product defect was fixed by this review.

Reference project identities and source expressions remain in plans/research,
with the [standalone MIT notice](upstream-license-notice.txt) retained. Original
TS wording/assets remain independent. No downloaded document or cloned binary
fixture was committed, shipped, made canonical or deleted. Meaningful findings
must become small original in-memory regressions before campaign cleanup.

Complete source-variant/public-owner/workflow acceptance, untested public APIs,
independent schema/renderer evidence and later public-consumer/cross-format QA
remain blocking gaps. The audit can explain every row without claiming those
obligations are fulfilled. No push, remote-main delivery or release occurred.
