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

These are author fixture-availability checks, not an independent packed freeze,
the historical original82 native oracle, the stream-next-stress harness, or the
read-only frozen60 independent inspection suite. Historical source-only evidence,
including 164 semantic / 124 strict / 40 stderr differences and the earlier 17
differences, is not promoted to a current full gate or full GNU parity. The local
native profile remains pinned GNU coreutils 9.7 on Darwin arm64 plus Apple/BSD
rev, not GNU/Linux; no oracle is downloaded or installed.
