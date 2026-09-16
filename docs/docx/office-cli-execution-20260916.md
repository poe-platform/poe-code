# DOCX Office CLI agent execution — 2026-09-16

Executed the [shared Markdown agent procedure](../plans/office-cli-qa.md) against
built DOCX commands through an explicit `/work` MemoryFileSystem and built Shell.
The [raw receipt](office-cli-execution-20260916.json) contains 75 initial probes,
exact commands, expected/actual exits, stdout/stderr, input fingerprints, audit
hashes and decoded output-part comparisons. Later recovery supplements remain
separately identified. This is agent QA, not a saved runner or screenshot suite.

Baseline: `63c1b36cf7ce80a4b072675bd3f237d593655d44`. DOCX's maintained five-build
closure was freshly built; the Shell adapter used existing built output and is
not freshly certified by this campaign. The interactive session retained baseline
dependencies across rebuilds. Fresh-process built probes and focused tests qualify
the owned diagnostic changes; old session receipts are not post-fix observations.

Model fixture creation supplied `2026-01-02T03:04:05Z`. Bare CLI creation produced
no core-property part, hence no invented date/author metadata. All document/media
I/O occurred inside the explicit VFS or byte streams. Development tools read
source and wrote evidence/screenshots only. No native document runtime, host
document/font/identity discovery, external-link resolution or network was used.
No publisher documents or cloned binaries were acquired, changed or cleaned up.

## Observed cases and limits

| Cases   | Observation                                                                                                                                                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q01–Q02 | Minimal creation succeeds without dates; template creation retains admitted DOTX kind/content types despite `.docx` output suffix.                                                                                                                       |
| Q03–Q05 | Text shorthand, all/second/first replacement succeed; body text and bold survive, header remains `Draft`, only document XML changes. Hyperlink retention variant is not run.                                                                             |
| Q06–Q07 | Three drawing occurrences and two unique byte hashes; typed null metadata and bounded warnings are explicit. Initial identical-byte occurrences have separate resources; shared-resource supplement is accounted for separately.                         |
| Q08–Q09 | Direct occurrence/shared intent commands succeed. Initial duplicate-byte resources are not evidence of two occurrences sharing one relationship. See supplement for that exact variant.                                                                  |
| Q10     | No transaction: refusal 3 has null data, zero effects and empty locations. Explicit partial-output consent succeeds with safe filenames and manifest. Injected failure/collision variants not run.                                                       |
| Q11–Q12 | Logical B2 reads and whole-cell assignment succeed; reopened cell is `Harbor 🌊`, other package parts retained.                                                                                                                                          |
| Q13–Q16 | List, existing-title get, typed boolean false and removal succeed. Reading absent original title returns selection 1; corrected setup reads `titled.docx`. Missing custom type rejects usage 2; diagnostic lacked a recovery route and is reduced below. |
| Q17     | Original tagged `heading` control fills from declared record schema. Unknown binding rejects usage 2, not the initial expected selection 1; this is closed-record validation. Diagnostic recovery reduced below. Repeated/nested expansion not run.      |
| Q18     | File, inline and stdin property batches publish byte-identical results. Unknown fields reject 2.                                                                                                                                                         |
| Q19–Q20 | Equal 0 and different 1 both return successful comparison data.                                                                                                                                                                                          |
| Q21–Q22 | Global/input capabilities expose subsets, limits, unsupported operations and unknown namespaces; no whole-model completion inferred.                                                                                                                     |
| Q23–Q27 | Unicode/space/leading-dash paths and document/JSON stdin work. Competing stdin rejects 2. Replacement-to-text pipe has no binary/banner contamination in observed result; individual-stage cancellation/transport injection not run.                     |
| Q28–Q30 | Dry-run needs no destination, permits proposed stdout plus JSON, and rejects existing sentinel destination 1 without changing sentinel/input. Conditional in-place edit succeeds. Incapable/stale-publication injection not run.                         |
| Q31–Q32 | Token selection succeeds; mixed token/simple selector rejects 2. Ordered edit changes fingerprint, old-token rejection 1 preserves intervening bytes, newly listed token succeeds.                                                                       |
| Q33–Q35 | Missing literal fails 1, allow-empty succeeds unchanged. Conflicting/omitted/repeated cardinality flags reject 2. Unmerged B2 succeeds; merged covered B2 rejects 1 with recovery guidance. No substitute coordinate chosen.                             |
| Q36–Q39 | Root help aliases agree, common flags lead help, nested image/cell help exposes selectors and output rules. Schema and version aliases work.                                                                                                             |
| Q40–Q42 | Missing comparison input gives comparison trouble 2; legacy singular path rejects with plural spelling. Table help explains logical coordinates and destructive assignment.                                                                              |
| Q43     | Missing image selection rejects before I/O, but original message had no selector/help route. Two original failing tests reduced this defect; fresh built diagnostic is corrected.                                                                        |
| Q44–Q45 | Binding JSON owns stdin and produces filled DOTX; competing template/document stdin rejects 2.                                                                                                                                                           |
| Q46     | Direct output alias and second symlink path reject 1 despite force. Inspection followed by explicit in-place succeeds. Input preserved on rejected attempts.                                                                                             |
| Q47–Q49 | Invalid scope rejects 2 with nested help; body-scope retry succeeds. Lowered depth returns 4; duplicate/unknown/raised limits reject 2. Table schema agrees with help and supported subset.                                                              |

SDK dry-run literal replacement independently reports the same two changes.
Reopened model values confirm cell assignment, retained header and bold formatting.
Batch results and decoded part hashes provide semantic evidence. Matching SDK
acceptance for every command is not run. Fixtures include an original blank
paragraph plus two text paragraphs, table/header and later images; they are not
publisher inputs or a substitute for large-document/rendering qualification.

## Original reductions and verification

Q43: `missing-selection-guidance.test.ts` originally failed both tests on missing
selector/help guidance after no-I/O/envelope assertions passed. The shared
validator now derives `--image N` and `docx help images replace` from its existing
contract. Fresh built process returns usage 2, null data, zero effects and no
source/dispatch, with no private values in its message.

Q15/Q17: `semantic-usage-guidance.test.ts` originally failed both memfs cases on
missing help paths after status, envelope and input preservation passed. The
inspection engine now adds the validated operation's help route to generic
semantic usage errors, within the existing diagnostic bounds. It does not expose
raw exceptions or document/argument values. Parsing keeps its specific errors.
The [owned procedure](../plans/docx-office-cli-qa-20260916.md) records red/green
and maintained verification; SDK categories, API spellings and semantics are unchanged.

Initial maintained suite: 223 files, 4,963 tests passed. Scoped lint passed with
one existing type-only-variable warning at `operation-types.test.ts:20`.
Five-build selected closure passed. Second improvement's final maintained suite
passed 224 files and 4,965 tests; its focused checks passed 15 tests. Scoped lint
and the five-build selected closure passed again. Fresh built semantic usage
returned the property help route at exit 2 with null data and zero effects;
its before/after screenshots were inspected.

Maintained `terminal-png` tooling rendered captured built output under disposable
`screenshots/docx-office-qa-20260916`. Inspected root help, image/cell help,
ordinary edit, stale/ambiguous/scope errors and missing-selection before/after.
The root `screenshot-poe-code` route does not expose this virtual DOCX command;
no broad root build or fake host DOCX wrapper was introduced. These screenshots
verify terminal usability, not document page fidelity. Exact screenshot hashes
are recorded in the supplement after final inspection.

## Exact JS/security mappings and documentation drift

The [mapping review](office-cli-qa-review.md#exact-js-and-security-mappings) and
three specifications remain authoritative. Neutral snake_case model members
remain primary; utility options are camelCase and CLI flags kebab-case. Admission,
image input and save are always async; admitted model access is synchronous.
Sequences use zero-based lookup, `.length`, iteration and documented `.at`/slice
profiles; CLI selectors are one-based and owner-scoped. Keyed styles/relationships
retain keys, `get`, `at` and `items`; no blanket aliases are added.

Null, false, zero and empty values stay distinct without coercion. Safe integer
EMU conversions use 914400/in, 360000/cm, 36000/mm, 12700/pt and 635/twip,
rounded once with halfway values away from zero. UTC Dates are copied and
serialized at whole seconds; utility timestamp strings remain separate.
Owned Uint8Array copies, per-axis DPI fallback 72, compatibility SHA-1 and evidence
SHA-256 remain distinct. Bounded XML/package views retain ownership/invalidation
and validated mutation; no XPath/evaluation/dynamic invocation or host/network
authority is introduced. Reads avoid creating getters.

Both complete inventories were parsed and traversed: 920 API records, 262 enum
values, 11 enum aliases and 23 documentation resolutions; 1,609 source unit
variants and 650 expanded BDD cases. Those are historical research denominators,
not new target passes. Inherited members, collections, helpers, returned public
underscore-prefixed owners and APIs without source tests remain in scope.
No type is hidden because its spelling starts with `_`.

Historical review claims that bindings/Q42–Q49 were unrun are superseded only
by scoped execution receipts. Built DOCX binding payload is
`{"values":[{"binding":"heading","value":"Coastal café"}]}`; DOTX filling
retains template kind. The exact unknown-binding status is usage 2. Today's
suite counts supersede earlier suite counts only for this checkout. Generic
help prose that says live image models remain pending is historical for later
implemented owner subsets; current capability/schema declarations and scoped
owner evidence govern, without a whole-API claim. Broader model/discovery
reconciliation is a later task and is not implemented here.

All PPTX counterparts are not run in this task. Its
[historical receipt](../pptx/office-cli-execution-20260913.md) remains separate.
Cancellation, injected source/sink/publication failures, exhaustive SDK/model
acceptance, shared header image edits, repeated/nested templates, large/corpus
qualification and native rendering remain not run. Later tasks remain pending.
No README edits, push or release occurred.

Local fixes: `976cd35e4` (missing resource selection) and `468efe7bc` (semantic
usage help routes). Evidence is committed separately; local commits do not
establish remote delivery or release.

## Shared-resource supplement

Five further probes reduced the setup gap through an original bounded model XML
edit, explicitly assigning the second drawing the first drawing's `rId3` resource.
The input SHA-256 is `8528cb69f2eb83b17bba5f6f8cda036a7559ac6ff00e2855ed72335150f3aefe`.
Inspection confirms the first two occurrences reference `/word/media/image1.png`.
Occurrence-only replacement changes the first hash and retains the second and
third. Shared replacement changes both shared hashes, retains the distinct third
resource, and preserves all three 12700-by-12700 EMU extents. Raw before/after
association snapshots and exact commands are in `sharedImageSupplement`.
The replacement bytes equal the distinct resource bytes, so its retained resource
path and unchanged hash distinguish preservation from accidental reassignment.
An initial SDK inspection call omitted its required operation field and was
corrected with actual CLI listings; this setup error is not an SDK defect/pass.
