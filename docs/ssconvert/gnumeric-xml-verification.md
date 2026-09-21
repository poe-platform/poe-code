# Gnumeric XML codec verification

The JavaScript `ssconvert` engine implements `Gnumeric_XmlIO:sax` import and
gzip export and `Gnumeric_XmlIO:sax:0` uncompressed export. Safe Bash invokes
the same engine with injected byte I/O. The native binary is a separate QA
oracle; no product path invokes it. Full Gnumeric 1.12.61 parity is **not
established** by this implementation or the source census.

The current retained-attribute/graph-property follow-up has a separate
[candidate receipt](gnumeric-xml-followup-verification.json). The historical
checks below apply to their original source hashes; they do not certify later
edits. The follow-up removes ignored core style/font/margin attributes, repairs
all six margin display-unit aliases, separates sheet-name SAX children from
named-expression children, and preserves graph GogStyle property children.
Independent negative controls reject GOStyle false type authority. Native GLib
invalid/unknown type diagnostics still differ. The source census now includes
delegated margin attributes and separates ignored Summary Item from Scenario Item.
Repeated uncompressed exports pass nine selected upstream Gnumeric corpus
variants under explicit budgets; this is deterministic serialization coverage,
not their complete native semantic compatibility. The initial graph budget
rejection and 28 erroneous object-style warnings remain in the receipt beside
the repaired, separately qualified run. Complete compatibility remains unfinished.

## Reference and evidence

- Official source archive SHA-256:
  `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
  Acquired source remains under `out`, outside product dependencies.
- [Reference profile](gnumeric-xml-reference-profile.json) records image,
  binary, linked dependencies, installed plugin manifest hashes, locale,
  explicit environment, command arguments and both diagnostic channels.
  Installed plugin manifests do not prove activation of every plugin.
- [Source audit](gnumeric-xml-source-audit.json) records 127 workbook SAX
  nodes, 472 writer calls, 79 delegated reader declarations and 76 delegated
  attribute references, with source locations and hashes. Dynamic writer
  arguments are recorded verbatim. Each entry distinguishes typed handling,
  retained XML and unmeasured behavior; a census entry is not a parity pass.
- [Additional native captures](gnumeric-xml-additional-native-captures.json)
  retain an original input and exact native calculation/gzip observations.
- [Independent native captures](gnumeric-independent-native-captures.json)
  preserve six original inputs, byte hashes, exact channels, namespace/version
  cases and source evidence for the follow-up repairs.
- The default-workbook round trip preserves
  [the failing native diagnostic](gnumeric-default-roundtrip-regression.json)
  and [the verified repaired output](gnumeric-default-roundtrip-verified.json),
  including complete source/JavaScript XML and byte hashes.
- [Date-convention captures](gnumeric-date-convention-captures.json) preserve
  four original fixtures and exact native results for attribute namespaces,
  document ordering, compatibility export and warning ordering.

## Verified scope

Original in-memory and memfs regressions cover plain/gzip detection, sparse
cells, source-declared namespaces, UTF-8/UTF-16 and Latin-1 examples, dimensions,
sheet ordering, scoped names, calculation/iteration settings, visibility,
shared-reference rebasing, array corners, rich-text runs, style/axis SDK edits,
merges, retained print/view/object/solver/scenario data, standard/custom scalar
metadata and uncompressed reimport of non-cell records.

The native oracle measured formula-cache omission, numeric `%.17g` formatting
examples (including ties-to-even and exponent padding), negative-zero
normalization, Latin-1 conversion, shared formulas, and warning/drop behavior
for unknown cell/comment children. Alias-prefix v10/v14 fixtures silently drop
the measured unknown Sheet/Cell attributes. Native calculation booleans compare
`false` case-insensitively and `0` exactly; other values are true. A new regression
failed before repairing that interpretation.

Independent source-validated regressions also cover nonzero integer axis flags,
XML declaration whitespace and reserved XML namespaces. Sheet-index consistency
matches the source's literal `gnm`/`gmr` prefix version selection and the effect of
a preceding Version element. A generic prefix alone retains native legacy
unknown-version behavior. Aggregate RLE axis expansion is admitted against one
workbook-wide node allowance; a two-sheet regression failed before this repair.
One-cell array corners retain their array group and explicit Rows/Cols pair.
Date conventions process in document order: native accepts the unqualified
calculation attribute, ignores the qualified attribute and exports both the
legacy element and qualified attribute for 1904 workbooks. Invalid convention
diagnostics precede descendant SAX warnings. Repeated calculation callbacks
update only present fields, preserving prior omitted settings.
Gzip cleanup registers before acquisition, closes admission immediately and
shares one completion promise across overlapping cleanup/finalization calls.
Deferred cooperative cancellation reproduced premature settlement before that
repair; the independent regression now waits for both cancel and abort.

A native-generated six-cell workbook initially gained erroneous value-owned
`ValueFormat="General"` attributes from its covering style. Native reimport
emitted a critical assertion for the boolean cell. After a failing regression
and repair, the same workbook's JavaScript uncompressed output and native
reexport both match the original byte SHA-256
`5029fdd4dc3f1a93895b1f6439fb464fa7645c1e407ab12b4cc153ccb0feffed`;
the reexport exits 0 with empty stdout/stderr. Present print, style, axes,
selection, layout, solver, calculation and sheet-index subtrees compare equal.
Objects, merges, filters, scenarios and geometry are absent in this fixture and
are not counted as passes. This fixture does not qualify all workbook families.

The additional native fixture produced identical gzip bytes on repeated
exports, with header `1f 8b 08 00 00 00 00 00 00 03`; its decompressed payload
equaled its uncompressed export. Unit tests compare deterministic XML payloads
independently of gzip headers. This does not establish byte equivalence of
JavaScript gzip or complete XML serialization to native output. A separate
default-workbook gzip probe found equal decompressed payloads but different
deflate bytes. Its original macOS OS marker differed from libgsf's hardcoded
UNIX marker; a failing regression preceded normalizing byte 9 to `3` on owned
output. The deflate-body difference remains recorded in
[the original gzip capture](gnumeric-default-gzip-regression.json) and
[the repaired-header capture](gnumeric-default-gzip-verified.json), including
the reference zlib package version and libgsf compression-source hash.

Safety regressions exercise external-entity rejection, bounded decompression,
XML depth/node/text bounds, cancellation, serialization/output bounds,
producer-owned bytes, namespace handling, attribute/name injection, cyclic SDK
records, replay and unchanged memfs destinations on rejected conversion.
Independent stress/fix work is documented in
[the procedure](../plans/ssconvert-gnumeric-independent-stress.md).

## Remaining mismatches and unmeasured cases

- Retention does not reproduce all native default synthesis, canonical ordering,
  enum normalization or exact XML byte serialization. Whole-workbook byte parity
  remain unverified beyond the measured fixture. The measured JavaScript/native
  gzip deflate-body inequality remains a mismatch despite equal XML payloads and
  the repaired header. CompressionStream does not expose libgsf's zlib settings.
- Graph plugin persistent properties and GOData, GOImage and GOComponent
  type-dependent subreaders are incompletely measured. Retained object records
  do not prove native object alias normalization or plugin semantics.
- Schema edges keyed by local names can conflate distinct SAX contexts. Unknown
  attributes in retained style/print/object records are not comprehensively
  filtered and diagnosed as native; version-dependent warning behavior is not
  fully reproduced. Multiple/conflicting version declarations remain unmeasured.
- A measured duplicate-namespace declaration produces a volatile native libgsf
  warning containing PID/time. The JavaScript parser does not reproduce that
  warning; exact native library diagnostic parity remains incomplete.
- Legacy formats, all declared encodings and every namespace/version combination
  have not been differentially verified. Invalid dimension repair, malformed
  formula fallback and warnings, forward shared references, and named-expression
  sorting are not fully measured.
- Advanced metadata vectors, dates and native type normalization remain
  unmeasured; unsupported non-scalar custom metadata is explicitly rejected.
- Automatic probing parses the entire document. Recognizable malformed XML can
  be rejected by the probe and subsequently selected as text; explicit Gnumeric
  import diagnoses XML errors. Native automatic malformed-input behavior remains
  unmeasured.
- Aggregate expanded axes are bounded; all other workbook metadata
  expansion and every relationship scan have not been fully qualified against
  the global work budget. Synchronous serialization observes an already-aborted
  signal; mid-serialization event-loop cancellation latency remains unmeasured.

Unsupported and unmeasured cases above are not passes. These limits mean the
requested complete native compatibility surface remains unfinished.

## Checks

### Current source-hashed follow-up candidate

The follow-up repairs ignored core Style/Font attributes, margin unit aliases,
sheet-name SAX context and mixed-content accumulation, and delegated GogStyle
properties. Each repair followed a failing regression or native differential.
A different agent supplied 15 independent tests and verified the final dispatch
restriction against the pinned native oracle. The focused codec set now has
74 tests; maintained uncached ssconvert tests passed 144 files and 3,985 tests.
Selected uncached build and package lint passed; rebuilt Safe Bash command
integration passed 49 tests. Manual SDK/native reimport verified the selected
style and margin fields, and the actual virtual-command screenshot was inspected.

Repository-wide uncached `npm test -- --no-cache` completed with exit 0, including
the root posttest lint-stress hook. Its declaration-derived runner reported
33 builds and 53 workspace test tasks. Safe Bash reported 44,097 passes,
831 skips and two todos; SafeJS reported 31,121 passes and 48 skips.
Workspaces without declared tests, skipped tests, the two unsupported todos,
and the unavailable optional comparator are not passes. Repository-wide lint
completed with exit 0, zero errors and four warnings, without guard gaps.
Repository-wide `npm run build` also completed with exit 0 against the final
source-hashed implementation after the full test run, including root suffix stages.
The earlier interrupted broad tests and incomplete lint traversal remain
recorded separately from the completed runs.

Nine selected released fixtures mapped to
`test/t6162-gnumeric-deterministic.pl` passed repeated XML byte serialization
under the recorded final budgets. This verifies determinism only; their native
semantic equivalence and the remaining upstream corpus are unverified.
The graph fixture's initial 100,000-node budget rejection remains a separate
failed matrix cell from its 1,000,000-node qualification.
[The follow-up receipt](gnumeric-xml-followup-verification.json) records source
hashes, authenticated archive/profile bindings, literal native captures,
runner membership, outcomes, negative controls and remaining mismatches.
The requested complete native compatibility surface remains unfinished.
No README edits, commits, pushes or publishing occurred.

### Prior candidate checks

The following historical results certify their recorded candidate, not later edits.

The final selected maintained uncached ssconvert build passed with its safe-fs
dependency closure; maintained package lint and TypeScript checks passed.
The final uncached package run passed 143 files and 3,961 tests after all
repairs; 50 focused codec assertions pass. The independent agent reviewed
the final Zoom precision change without edits. Native field precision
[measurement](gnumeric-field-precision-capture.json) confirms four-significant-
digit Zoom serialization and shortest iteration tolerance serialization.
An existing statistical-tail test timed out during an earlier full package run.
The independent agent reproduced and repaired its exact arithmetic allocation
cost without changing timeouts, assertions, numeric results or work ticks;
[the repair evidence](gnumeric-unit-timeout-repair.json) records the measured
improvement. The final maintained package run includes that regression.
Safe Bash XML/text/encoding integration passed 49 tests against rebuilt public
engine imports, including exact warning/error bytes, statuses and unchanged
destinations. Maintained integration-input checks passed 120 tests.
The uncached Safe Bash build closure passed. Repository-wide `npm run lint`
passed its guarded ESLint, type/contract and workflow checks. The virtual
exporter listing screenshot was inspected successfully. Repository-wide `npm test -- --no-cache` completed with exit 0 through its
maintained declaration-derived runner and root posttest lint-stress hook. The
runner reported 33 builds and 53 declared workspace tests; no-test workspaces
are explicitly not passes. Safe Bash reported 44,097 passes, 831 skips and two
todos; SafeJS reported 31,121 passes and 48 skips. An unavailable optional
comparator is pending, not a pass. The broad run also repeated ssconvert
after the final repairs and passed 143 files/3,961 tests.
[The final receipt](gnumeric-xml-checks.json) preserves the runner membership
summary, source hashes and output hashes. Task-owned scratch logs/captures
were reduced into the evidence and removed; preexisting source/oracle
acquisition remains under `out`.
No README files were edited; nothing was pushed or published.
