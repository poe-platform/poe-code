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
