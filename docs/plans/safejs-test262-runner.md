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
