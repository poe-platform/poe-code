# Issue 681: bounded GNU tsort

## Requirement and native reference

Implement `tsort [FILE]`: read node pairs, emit deterministic topological order,
report cycles on stderr with nonzero status, and bound nodes, edges, input,
retained memory, output and work. Use supplied VFS paths and byte streams only,
with cooperative cancellation and no implicit host process or network fallback.

The original reference is GNU coreutils 8.30, Ubuntu 8.30-3ubuntu2, applied source
commit `26a1fa64acd11d62b28a59fab6b938ab57d12ba7`. The full 573-line `tsort.c`
has SHA256 `158ea317d09c586d3d02bcd676f5c8676a76c55276dbd00f016dbb45eaf45b8f`.
Source and installed binary bindings are recorded under
`/tmp/issue681-ubuntu-source-1gyoeypp`. The initial native capture has 41 cases
in `/tmp/issue681-tsort-readonly-v3-rr7auvy9/native.json` and three additional
cases in its `extra-native.json`, not 44 entries in the first file alone.
Read the original implementation and relevant helpers before implementing;
this is a finite Linux reference profile, not proof for every GNU version.

## Semantics and ownership

Match byte-lexical initial zero-indegree ordering, then FIFO processing rather
than a continuously sorted priority queue. Preserve reversed successor insertion
order, duplicate-edge effects and self-pairs that create nodes without cycles.
Cycles must be found and broken in the native deterministic order, including
continuing stdout output after diagnostics; returning just any valid ordering
or refusing all cyclic output is insufficient. Odd token counts fail before
output. Qualify SPACE/TAB/LF delimiters, raw high bytes, native C-string NUL
handling and input/option/file-error behavior explicitly.

The author owns `src/commands/tsort`, focused tests and `docs/TSORT.md`; the
independent reviewer owns separate native/adversarial tests. Root owns public
integration, literal discovery, this plan and delivery. The inventory worker
updates existing current expectations and packed consumers, not sealed history.
No README additions are authorized.

Expose `createTsortCommand`, `createTsortCommands`, `tsortCommands`,
`TsortCommandsOptions` and `TsortLimits`. Append tsort after pr, retaining the
existing preset order and aggregate replacement policy. Forward only family
limits through `AgentCommandsOptions.tsort`. Provide root/scoped Node and
co-bundled browser/workerd subpaths with identical public factory objects.

## Test-first acceptance

Reproduce absence through public factories and actual saved virtual scripts.
Compare exact native stdout, stderr and status, not just graph validity. Add
bounded-graph and cancellation tests with owned input fragments, backpressure,
registered cleanup and falsey reasons, using the now-fixed shared output and
DeviceFS boundaries rather than command-specific workarounds. Cover cancellation
during acquisition, graph construction, sorting, cycle detection and output.

Run independent review, maintained discovery, full repository tests/lint, normal
build, types, committed-archive and fresh packed consumers. Inspect terminal
output visually. Preserve every failed attempt, do not synthesize unavailable
profile passes, and distinguish Node-executed browser bundles from real browsers.
Verify remote main before closing #681; monitor actual publication while moving
to the next issue. The user's earlier macOS exclusion remains in force.

## Public regression evidence

Before integration, four actual individual tests fail in
`/tmp/issue681-public-red-v1.log`: missing public factories/preset registration,
saved-script FIFO ordering, cycle output/status, and odd-token rejection. These
use MemoryFileSystem and recorded native byte/status expectations. Public wiring
also adds aggregate limit forwarding with a nested replacement getter that must
never be consulted. Root/scoped browser entries are co-bundled with the core.

The initial five public integration tests pass in
`/tmp/issue681-public-integrated-v1.log`. Current inventory and source/mock
consumer checks pass 633 Node cases and 46 browser/metadata cases. These do not
certify later command fixes or packed/dist consumers.

## Readable-device finding

Native and actual-Shell comparisons in `out/issue681/null-input-red-v1.json`
validate that the initial tsort reader wrongly rejects `/dev/null` as a non-file.
The already-delivered pr reader has the same issue; #680 is reopened and its
separate fix is tracked in `docs/plans/pr-readable-device-input-20260910.md`.
Implement bounded VFS-readable character input rather than special-casing a
pathname or bypassing DeviceFileSystem. Preserve native ordering and the pinned
directory behavior. Native/independent/source/packed device regressions are
required before claiming either follow-up complete.

## Frozen source review

The final author suite passes 98 cases in `/tmp/issue681-author-final-v3.log`.
Independent review passes 93 cases in
`/tmp/issue681-tsort-independent-green-v1.log`, including option diagnostics,
cycles, raw byte/NUL identity, device and symlink inputs, resource limits and
cleanup. Both focused typechecks pass. These source-level results do not replace
the pending full tests, final build and fresh packed-consumer qualification.
