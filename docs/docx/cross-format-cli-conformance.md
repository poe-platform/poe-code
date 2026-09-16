# Cross-format CLI conformance verification

Historical verification. Superseded for the corrected common cases by
[the follow-up record](cross-format-cli-conformance-followup.md). The results and
pending statements below describe the earlier revision.

Status: Partial verification on 2026-09-15. Both public adapters are available;
full shared-contract conformance is **not** established. Only the
`cross-format-cli-conformance` task was exercised. Later tasks remain pending.

The [machine-readable receipt](cross-format-cli-conformance.json) records hashes,
26 common schema paths, option-name intersections/differences, rejected-spelling
transcripts and actual cancellation outcomes. The
[owned plan](../plans/docx-cross-format-cli-conformance.md) contains the agent QA
procedure and scope. No production source was changed by this verification.

## Original acceptance coverage

[Original memfs tests](../../packages/docx/tests/cross-format-cli.test.ts) invoke
`virtual-bash/commands/docx` and `virtual-bash/commands/pptx` with the public
format-package engines. Test imports use public package exports; the maintained
Vitest configuration resolves workspace exports to current source. Built
discovery and cancellation were additionally inspected after both selected
workspace build closures passed. Documents and presentations use original short
content, authored defaults and in-memory bytes; no downloaded corpus or native
reference implementation is needed.

| Contract | Observed coverage |
| --- | --- |
| Common paths | inspect, text/text get, images list, properties list, capabilities, schema, help and version execute in both tools |
| Direct mutation flags | text replace find/with/all, properties set name/value, dry-run JSON; inputs retained |
| Output | Both output spellings produce pure ZIP stdout, readable through each format's own public text command; binary plus JSON rejects, dry-run plus proposed binary output allows JSON |
| Ordinary statuses | 0 success, 1 malformed input, 2 usage, 3 missing input, 4 oversized input through both public shell adapters |
| Diff statuses | 0 equal, 1 different with ok true, 2 malformed/missing input or usage trouble; format-specific scope declaration required for DOCX |
| Cancellation | Public PPTX engine resolves 130 for inspect and diff; DOCX rejects AbortError in both actual input-cancellation probes |
| Rejected spellings | image list, table list, metadata list and top-level replace return 2 before input acquisition in both adapters |
| Flags | Inapplicable publication/cardinality/scope flags, repeated JSON/scalars, conflicting cardinalities/publication intent, unknown options and duplicate/unknown limits reject before input acquisition |
| No-match edits | Reject by default; explicit allow-empty permits a zero-affected dry-run result in both tools |
| Schemas | Common text-replacement option names, required find/with, closed option objects and envelope fields are declared; JSON schema wrapper shape is normalized for comparison |

These are finite acceptance cases, not whole-command, whole-selector or whole-API
coverage. Image insertion/extraction/replacement with actual image resources,
merged cells, stale handles, all public model examples and every optional flag
combination are not newly qualified by this task.

## Unresolved conformance gaps

Four original target tests are explicitly skipped rather than counted as passes:

1. DOCX `tables list` is declared with reject support and returns
   1/unsupported-profile. PPTX executes the path.
2. PPTX `validate` has no declared operation schema and returns 2/invalid-value.
   DOCX executes the path.
3. Bare DOCX `diff LEFT RIGHT` returns 2/usage because the format spec requires
   explicit scope. PPTX executes a bare comparison. The exact shared recipe is
   therefore unqualified. DOCX parts/xml use scope package; its text comparison
   uses scope body. PPTX diff rejects scope rather than ignoring it.
4. Actual DOCX input cancellation rejects AbortError (numeric DOMException code
   20) rather than resolving exitCode 130. PPTX resolves 130. External cancellation
   of Shell.exec also rejects; that shell API boundary must not be confused with
   a command returning a shell exit status.

Additional inspected gaps are retained in the receipt. Rejected-path JSON
transport differs: DOCX emits no JSON value, while PPTX emits an inspect-labelled
failure envelope. PPTX executes discovery paths but omits schema/help/version
from its schema operation register; capabilities is declared. Targeted PPTX text
replacement help prints the entire command overview.

This verification records those failures without implementing later feature or
whole-API tasks. The pipeline task must remain open for full conformance; no
paired-success or complete-contract claim is made.

## Exact JavaScript/security mappings and documentation drift

The retained API inventory has 920 records and 23 documentation resolutions; the
test inventory has 1,609 unit variants and 650 expanded BDD cases. They were read
and accounted for without changing historical dispositions. The
[API reconciliation](upstream-api-reconciliation.md#language-and-security-decisions)
remains authoritative for the model mapping, including inherited members, enums,
helpers, collections, guide-only behavior and publicly documented
underscore-prefixed owners. No such API is reclassified as private here.

This task executes async utility engines with explicit memfs input, owned byte
streams, output sinks, trusted limits and cancellation. Operation JSON retains
camelCase names corresponding to CLI kebab-case. Model spellings such as
add_paragraph, core_properties and comment_id remain separate retained neutral
names; no blanket alias layer or metadata command alias is introduced.

Model sequence mapping remains zero-based numeric lookup, length and
Symbol.iterator, with explicit at/slice where supported; CLI selectors remain
one-based scoped positions and fingerprinted locations. Null remains explicit
absence/inheritance, distinct from false/zero/empty text. Image admission and
save/factory boundaries remain always async; admitted model access remains
synchronous. Units use checked integer EMUs (914400/in, 360000/cm, 36000/mm,
12700/pt and 635/twip), nearest rounding with halves away from zero. Dates remain
explicit UTC Date model values with whole-second XML precision; no ambient time,
identity, fonts, filesystem or network authority is introduced.

The existing 23 source/guide drift dispositions remain unchanged, including
comment_id/timestamp versus erroneous id/date examples and documented public
table_direction rather than an invented direction alias. Shared CLI diff grammar
versus DOCX's explicit-scope rule is recorded above as unresolved drift, not
silently normalized. No model API or source-test case is promoted to implemented
by these utility checks. Whole-public-API acceptance remains a later task.

## Maintained checks and visual inspection

| Check | Result |
| --- | --- |
| Initial paired run | 34 tests: 29 passed, 5 failed; feature/scope gaps reproduced, external-shell cancellation harness corrected |
| Final paired suite | 52 tests: 48 passed, 4 explicitly skipped target cases |
| npm test --workspace=docx | 172 files passed; 3423 tests passed, 4 skipped; 131.19 seconds |
| npm test --workspace=pptx | 269 files and 6874 tests passed; 56.85 seconds |
| npm run lint --workspace=docx | Passed; one existing unused-variable warning in operation-types.test.ts, no errors |
| npm run lint --workspace=pptx | Passed |
| npm run build:workspaces -- --workspace=docx | Selected maintained closure passed, including declared safe-fs portable dependency |
| npm run build:workspaces -- --workspace=pptx | Selected maintained closure passed |

The first full DOCX run failed only in the new test's assumption that envelope
properties live at the result schema's top level. DOCX uses oneOf branches. The
assertion was corrected and the full maintained package suite rerun successfully;
no production behavior was changed to accommodate the test.

The maintained `npm run screenshot` route captured built public-engine targeted
help and conflicting-cardinality errors, with no document input or networking.
The root CLI does not expose these explicitly injected format adapters as direct
root commands, so screenshot-poe-code was not substituted for adapter evidence.
Both PNGs were actually inspected: errors are readable, DOCX help contains the
replacement rules, and PPTX targeted help is excessively long. Disposable paths
and hashes are in the receipt; screenshots are not unit snapshots or committed
fixtures. Original tests run independently of these PNGs. No downloaded inputs,
clones or unrelated QA output were deleted.

Only the new tests, owned plan and evidence are eligible for the local atomic
commit. Unrelated worktree changes are preserved. No push or release is authorized.
