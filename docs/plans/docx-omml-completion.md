# Bounded equation task completion

Scope: task 76 only. Later tasks remain pending. This continues the existing
[equation plan](docx-omml-equations.md), preserving its historical REDs and all
pre-existing working changes. Product implementation is already local on main in
`fec7afeb8`; no push or release is authorized.

## Verification procedure

1. Read root/scoped instructions, docx.md section 6.5.4, office-cli.md,
   office-sdk.md and the API audit/inventory. Verify the existing original tests
   and implementation rather than recreating their failing-test history.
2. Run the maintained selected DOCX workspace build, complete DOCX package tests
   and package lint/types; verify portable exports, exact integration registration
   and actual Shell equation tests. Obtain the scoped independent review required
   by safe-bash instructions before corpus operations.
3. Admit only the manifest-pinned nz-ghg-inventory-2025-vol-1 file after SHA-256
   verification. Use it solely as disposable QA input. Execute individually
   supervised transient operations, with explicit byte/retention/work limits and
   cancellation. Never save a host executable QA driver or fetch product resources.
4. Compare inventory to the recorded 45 OMML expressions, inspect math properties,
   verify ordinary text replacement retains exact original math, and exercise
   explicit validated fragment insertion/replacement and unsupported-tree refusal.
   Reduce any meaningful defect to a small original memfs RED before correction.
5. Inspect actual command-output screenshots. Record outcomes and limits honestly;
   preserve cached historical inputs and all pre-existing changes. Commit only new
   owned completion evidence and any independently validated atomic correction.

## Exact language/security mappings

The pinned API inventory identifies `docx.text.run.Font.math`, canonically
`docx.text.font.Font.math`. It is the existing nullable WML boolean formatting
flag; it is not OMML content. Its neutral public spelling `math` remains unchanged.
Existing formatting-model coverage and the historical API register are retained.
No equation-specific live owner, inherited member, enum, collection or helper is
newly promoted to implemented, and underscore-prefixed public owners stay pending.
The documentation/source discrepancy resolutions remain unchanged.

The additional equation utility signatures retain their documented names:
`inspectDocumentEquations`, `addDocumentEquation`, `replaceDocumentEquation`.
They always return Promises. Owned Uint8Array input and typed BinaryInput fragments
replace host paths; CLI scoped VfsInput uses the same engine. Snapshot attributes
retain stored strings, with no defaults, evaluation, LaTeX conversion, font lookup
or resource activation. Source-bound physical tokens reject stale/fabricated
selection before fragment acquisition. Wrong/malformed/unsupported new fragments
refuse under the shared error model; broader stored trees remain inert metadata.

## Results

Initial maintained verification passes: selected workspace build (five dependency
stages), DOCX lint/types (one existing type-only-variable warning), 2,865 tests in
134 files, two portable export tests, three actual Shell tests and 108 integration
registration tests. Independent scoped review found no equation-specific defect;
five additional original in-memory security/grammar probes passed.

The first corpus profiles refused safely at the default work limit, then the
1 GiB retention ledger, then 64 KiB and 1 MiB diagnostic ledgers. These are
conservative accounting ceilings, not process RSS measurements. No defaults were
raised in product code. The final inventory QA host profile grants 8 GiB work,
4 GiB retention accounting, 20 million cumulative XML nodes and 8 MiB diagnostics,
with 120-second cancellation per operation; compressed/expanded limits remain
64/256 MiB and individual XML parts 32 MiB.

Ordinary replacement found a separate concrete blocker in internal staged
validation: snapshot used standalone validation's fixed 200,000-node default,
despite a larger explicit host grant. The stack reaches validateDocumentArchive
through DocumentArchiveEditor.snapshot during location acquisition. A small
original mocked-policy regression is required before the minimal writer correction.
The independently reviewed writer worker owns only package-write.ts and the new
package-write-budget.test.ts; standalone validation defaults must remain intact.

Actual Shell equation-add help screenshot was captured and inspected. The first
capture failed because its automatically generated filename exceeded the filesystem
limit; explicit output and no wrapper header corrected capture construction.

The final original correction is one atomic internal-validation improvement:
snapshot inherits node/byte/part ceilings, and ordinary and original-byte publication
inherit XML node ceilings while retaining their existing byte/part guards. Root owns
document-write.ts, publication.ts and document-write-budget.test.ts; the worker's
snapshot files are integrated without unrelated edits. Two snapshot and two
publication assertions failed before their corresponding code changes; semantic,
cumulative-budget and no-output controls stayed intact. The six new tests are small
original in-memory/memfs regressions independent of corpus downloads, with spies on
the real validator rather than mocked success.

Final maintained verification passes: selected uncached build (five stages), DOCX
lint plus production/test TypeScript checks (same one warning), 2,871 tests across
136 files, three actual Shell tests and two portable bundled-export tests. Existing
134 suites and names are preserved. No root public API or schema changes were
needed for this correction. A different worker approved root publication changes;
root reviewed the worker snapshot changes and real semantic/exhaustion controls.

Corpus inventory succeeds under the explicitly enlarged accounting profile: exactly
45 units/expressions, one inline and 44 displays, 5,045 local property nodes and 12
global properties. All existing trees are opaque/preserve-only under the smaller
new-fragment grammar. This is physical inventory evidence, not full XSD or edit
qualification. After the node-budget correction, ordinary replacement refuses
14 existing style-next-type conflicts before publication. That unrelated style
family stays pending; no validation bypass or source normalization is permitted.
Successful corpus text-preservation qualification is therefore not claimed. Original
fraction/matrix/subscript and ordinary-retention unit coverage remains passing.
