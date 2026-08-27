# Exact legacy fixture migration

This author-only migration preserves the five owned original files (and the two
availability README files) byte-for-byte as base64 plus SHA-256 in
`original-bytes.json`. `original-registry.ts.txt` is the committed pre-integration
`b7e9eb5^:tests/plugins/agent-commands.test.ts` expected-list source;
`baseline60.json` preserves that list in its original order. Actual factory and
installed registry measurements verify exactly that frozen60 plus only `seq`,
`nl`, `rev`, `unexpand`, `split`: 65 unique names. The previous four inspection
commands remain at positions 56–59. Curl and SafeJS remain optional.

The unchanged 189 author tests initially produce 41 passes and 148 failures:
public author 19/21, format contracts 15/19, split integration 6/7, format native
and limits 1/122, format native stress 0/20. No tests skip or cancel. Exact TAP,
source/fixture hashes before and after, platform, oracle hashes and working-tree
state are in `original-runs.json`. `registry-runs.json` separately records the
literal/presence/order migration: 45/189 pass, with the remaining 144 failures
still caused by the intentionally not-yet-migrated duplicate-install helper.
Neither step changes native fixture inputs, utility diagnostics or algorithms.

The isolated original build succeeds. The first consumer compiler attempt has
a harness TS2209 error because its package boundary/rootDir were omitted;
`original-consumer.json` preserves it. `original-consumer-corrected.json` records
the corrected harness: unchanged consumer types pass and runtime fails exactly
at 65 !== 60. Only the owned ignored `dist/` subtree contains copied source,
generated configuration, package layout and emitted files; root dist is untouched.

`registry-witness.json` retains a new-test harness defect: comparing a registered
definition to the caller's input object ignores CommandRegistry's shallow copy.
The correction compares pre/post registered references instead; no product
change is involved. Its six-case rerun is recorded separately.

The separate helper correction routes its existing options through
`AgentCommandsOptions.streamFormat` rather than installing the now-default family
twice. Only an explicitly supplied `replace` moves to the aggregate's top-level
replacement boundary; no blanket replacement is added. Existing guest locale,
per-invocation signal and limits remain exercised. `helper-runs.json` records
189/189 revised author tests passing with no skips. `helper-checks.json` records
12/12 added registry/options witnesses and the strict scoped typecheck passing,
including separate `AgentCommandsOptions.split` limits and rejected duplicate
explicit plugins. The original native inputs and diagnostic assertions are
unchanged; this helper execution change is disclosed, not unchanged-harness proof.

`final-runs.json` repeats all 189 revised cases successfully. `final-consumer.json`
records a successful isolated ESM/declaration build, strict compilation and
execution of the migrated original consumer (12 inspection dispatches and both
aggregate pipeline modes), plus the new root/subpath options consumer. The latter
checks actual formatting/split factories, plugins, option/limit types, top-level
replacement typing, standalone families and default aggregate configuration.
`final-invariants.json` proves identical hashes for all 159 tracked runtime TS
files, 93 existing unmigrated test/evidence files, 11 native fixture sources and
three root configuration files across the original and revised captures. Six
unchanged fixture/helper-body segments additionally preserve the original native
adapter, inputs, diagnostic assertions and non-availability tests. Exactly the
five authorized existing test/helper files differ before the documentation step.
The compiler is TypeScript 5.9.3 and runtime is Node v22.22.2. No root build or
independent holdout suite is run. Final packed independent proof remains pending.

These are author fixture-availability checks, not an independent packed freeze,
the historical original82 native oracle, the stream-next-stress harness, or the
read-only frozen60 independent inspection suite. Historical source-only evidence,
including 164 semantic / 124 strict / 40 stderr differences and the earlier 17
differences, is not promoted to a current full gate or full GNU parity. The local
native profile remains pinned GNU coreutils 9.7 on Darwin arm64 plus Apple/BSD
rev, not GNU/Linux; no oracle is downloaded or installed.
