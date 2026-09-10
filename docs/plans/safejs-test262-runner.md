# Maintained Test262 runner

## Contract and remaining scope

Follow the pinned [Test262 interpretation contract](https://raw.githubusercontent.com/tc39/test262/419d3e0a2273ba01a3bfcbec423f2801425b8e93/INTERPRETING.md).
The internal global Script entrypoint is local commit 181638f64. It does not
itself provide corpus selection, host APIs, module loading, asynchronous result
classification, or an authoritative conformance report.

Build a maintained route in the package's conformance test infrastructure.
Use fresh realms, original upstream sources, declared harness order and
explicit execution modes. Preserve negative phase/type requirements. Report
fixture files, unsupported host capabilities, metadata errors and exclusions
separately from passing tests. Do not substitute the module SDK or indirect
eval for global Script evaluation. Resource failures remain failures, not
semantic passes. The runner is test infrastructure, not a scripted QA plan.

## Metadata stage

`test/conformance/metadata.test.ts` first failed because the implementation
module was absent (30215, terminal d6af39). It specifies ordinary dual-mode
execution, strict/non-strict/module/raw selection, source preservation, async
harness ordering, YAML metadata, fixture classification, and rejection of
malformed or unknown flags rather than silent defaults.

The implementation parses the metadata with the maintained YAML dependency.
It produces execution variants without executing guest code or claiming a
pass. Raw source remains unchanged with no harness; metadata lists and negative
expectations remain available to the executor and report layer. All 16 tests
and scoped lint passed (84979, terminal ef8af4); whitespace checks passed.
This stage alone is not a corpus runner.

Next stages: owned realm host and `$262` APIs; execution/phase classification;
async completion and cancellation; source-module dependency resolution; pinned
corpus discovery with machine-readable results; upstream qualification. Each
stage must retain the full contract rather than turn unavailable modes into
green results.

## Owned realm host

The realm-host tests initially failed because the module was absent (48135,
terminal 51b10f). The first implementation passed isolation, resource-failure
classification and pending-work disposal, but failed primitive thrown-value
preservation (38101, terminal cf9e3f): requesting surfaced interpreter errors
turns `throw 42` into a host Error. The conformance host now uses the existing
raw thrown-value path rather than changing guest runtime semantics. Parse,
runtime and host-error outcomes remain distinct. The four host tests and
metadata tests are being rechecked with scoped lint. Host-defined `$262`
capabilities, module execution and async result classification are still open.
The corrected host and metadata selection passed all 20 tests and scoped lint
(3821, terminal faf31f); whitespace checks passed. The host is ready for its
own local commit, without implying the still-missing `$262` API is implemented.

The owned host is local commit 8a8b7ae6a. Four additional host API tests then
failed on the missing `$262`/`print` bindings (46242, terminal 3aeaeb). The
candidate installs non-enumerable global bindings, an ordinary `$262` object,
same-realm `evalScript`, independently owned child realms, and guest string
conversion for `print`. Nested Scripts use the existing nested interpreter
route so they do not deadlock by enqueueing behind their own running job.
Disposal includes child realms. All eight host tests pass (51508, terminal
a59574); combined conformance/Script tests and lint are now running.
Detachment, GC/agent capabilities, module loading and result classification
remain incomplete; the partial API is not advertised as complete Test262 support.

The combined selection passed 63 tests and lint (98309, terminal 9892c8).
An additional child-cancellation regression then passed with all nine realm
tests and test lint (61557, terminal 8b0764). The host API addition is ready
for a scoped local commit. Review also identified a candidate classification
gap: an uncaught unbound identifier reaches the host as an interpreter
diagnostic, unlike an explicit throw. Validate that separately before changing
the interpreter or result classification.

The host API addition is local commit 9074a1d20. Three new regressions then
validated the reference classification gap (36589, terminal 558f85; 48 controls
passed), report `/tmp/safejs-script-reference-errors-red.json`. Script mode
returned the SDK's `UNBOUND_IDENTIFIER` diagnostic for an uncaught missing
identifier or update, so the runner could not classify it as a runtime throw.
The candidate converts only branded source-reference diagnostics in Script
mode through the existing guest throw-completion constructor, before final
data reconciliation. The SDK's diagnostic contract is unchanged. Focused
Script/host/reference-error checks and scoped lint/build are running.

The reference-error candidate passed all 266 tests across seven files (97007,
terminal 2eb5d9), report `/tmp/safejs-script-reference-errors-fixed.json`.
These include the SDK diagnostic-contract and reference-delivery regressions.
Scoped lint passed; the maintained workspace build completed all 23 builds and
five fresh-process imports (7738, terminal 949ee6). Whitespace checks passed.

A read-only classifier probe (59351, terminal 6ad867) confirms that the
existing sandbox data-property lookup recovers `ReferenceError` and `TypeError`
constructors for runtime throws, while `{name:"TypeError"}` still has the
`Object` constructor and a primitive throw has none. Parse errors remain native
SyntaxErrors at the host boundary. The result classifier must not equate a
user-controlled `name` field with the expected exception constructor.

## Result classification

The Script reference-error repair is local commit 19ac58a3e. Result-classifier
tests first failed because their module was absent (33944, terminal 1ce95c).
They cover normal/uncaught outcomes, matching negative type and phase,
wrong/missing throws, host-error rejection, spoofed `name` fields, primitive
throws, and non-invocation of constructor getters during reporting.
The candidate reads error-constructor data without executing guest accessors.
It classifies only an already completed Script outcome: asynchronous completion
and module resolution are not implicitly treated as done or passed. Combined
conformance tests passed all 40 cases and scoped lint passed (56733, terminal
7ec1f5); whitespace checks passed. This is ready for a local classifier commit.

## Execution lifecycle

The classifier is local commit 19683cee1. Executor tests first failed because
the module was absent (47889, terminal c8e54a). The executor now creates fresh
realms per variant, evaluates harness files in order, classifies completed
Script outcomes, waits for explicit async completion, rejects async failure
signals, enforces a timeout/deadline and disposes each realm. Missing/failing
harness files cannot masquerade as expected guest errors. Modules and explicit
agent blocking modes are reported as unsupported, never passed, until their
execution adapters exist. Fixture files remain separate from test results.

All ten initial lifecycle tests pass (33035, terminal e7c971), including a
fake-timer timeout, late failure after an async completion signal, and raw
source without harness injection. The full conformance-infrastructure selection
and scoped lint are running. This is still not a pinned corpus discovery/report
route, and unsupported modules/host capabilities remain required work.

The combined selection passed all 50 tests and scoped lint (64720, terminal
008349). Loading the actual pinned `assert.js`, `sta.js`, and
`doneprintHandle.js` in memory passed seven synthetic execution variants
(17198, terminal ed4ac1). Those are harness checks, not seven upstream tests.

The actual pinned `test/built-ins/Array/of/proto-from-ctor-realm.js` failed in
both modes (61482, terminal 78ebb7). Direct outcome inspection (75871,
terminal d13198) found `Dynamic function realm has no execution context.`
A newly created child had not executed any Script, so using its Function
constructor immediately was invalid in the adapter. A focused host regression
now reproduces that upstream sequence before changing child initialization.

The focused regression failed with eleven passing controls (46669, terminal
56efc6). The host now initializes the child through an empty nested Script
before exposing it, establishing the interpreter's realm execution context
without changing the upstream source or adding guest bindings. Combined tests,
lint, and the unchanged upstream case are being rechecked.

All 51 infrastructure tests and scoped realm lint passed (12579, terminal
4740fa). The unchanged pinned upstream cross-realm case now passes in both
sloppy and strict modes (87601, terminal 28c72c). The child initialization
repair is qualified independently of still-missing module and agent adapters.

The Script executor is also qualified for its scoped local commit: its source
and tests have not changed since the 50-test/lint pass, and the subsequent
51-test run and unchanged upstream case exercise it with the repaired host.
Corpus acquisition, revision verification, discovery and a durable report
remain the next missing layer; these commits alone do not cover the corpus.

Local commits: e41efac2e repairs child initialization; 067b2a062 adds Script
execution. Acquisition of the exact pinned upstream revision has started in
`/tmp/safejs-test262-corpus.19JhPM` (45121), with detached checkout and explicit
revision verification. This is external test data, not a project branch or a
release. No corpus result is claimed until acquisition and execution complete.

The detached checkout verified the exact pinned hash (45121, terminal 582dc1).
A full metadata-only inventory (43879, terminal 8d8e00) found 53,876 JavaScript
files: 53,581 parsed tests, 294 fixtures, and one metadata error. Parsed tests
produce 102,924 variants (52,030 sloppy, 50,021 strict, 32 raw, 841 module).
No test execution is implied by this inventory. The sole metadata error is
`built-ins/Function/prototype/toString/line-terminator-normalisation-CR.js`:
the YAML parser rejects its CR-only metadata. Source line endings must remain
unchanged; validate a metadata-only normalization fix before repeating inventory.

Deterministic discovery tests initially failed because the module was absent
(85427, terminal 4597da). The candidate uses normal filesystem reads with memfs
tests, retains fixture filenames, sorts and deduplicates selected paths, and
rejects escapes, symbolic links and empty/missing selections. Its focused
checks are running while the CR-only metadata defect is queued for reproduction.

Discovery passed all seven initial tests (99778, terminal 8d1b1c). The CR-only
metadata regression then failed while eighteen controls passed (82045,
terminal 88148b). The candidate normalizes CR/CRLF only in the extracted YAML
substring; the original test source and variant source are unchanged. Combined
conformance tests and scoped metadata/discovery lint are running.

All 61 infrastructure tests and scoped lint passed (67384, terminal fe312a).
The unchanged upstream CR-only file now parses with its source preserved
(15303, terminal 0b7d36), but both execution variants fail during harness setup.
Direct inspection (4468, terminal a5e59d) isolates `nativeFunctionMatcher.js`:
its large Unicode regex exceeds the fixed regex-source cap (4097 > 4096).
This is a separate resource-policy limitation, not a remaining metadata error
or a semantic pass. No guard or harness source was weakened to bypass it.
The repeat whole-corpus metadata inventory through maintained discovery remains
live under 88195; do not substitute focused results for its final accounting.
