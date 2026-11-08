# Frozen exact-env preparation, not author READY acceptance

Frozen independent commit **134b460** contains15 native rows and10 host-contract
requirements. No runtime-author environment test definitions were inspected.
Both whole real native profiles completed15/15 captures with no deadline/signal/
overflow/group-leak failures. Native source snapshot was still diagnostics runtime
`e886b64536c7496769fdbe856aafb0e73ee88ace47c2a3ca9cb3cc71f11f8c4a`.
The unchanged original `env -i A=1 B=2 env -u A` returns exactly `B=2\n`, empty
stderr, status0 in BOTH GNU5.3 and historical3.2 captures.

## Fresh moving-source results

At02:44 and02:45 UTC on August27,2026, product executions loaded uncommitted runtime
`7aaaaff3ebc18c65556036878e48a4977b55bc2689adfc647c20be663f3cdd42`.
This is NOT committed489c8b7, and no environment-author READY was awaited or used.
All25 per-row actual-import guards are valid in each recorded run:130 actual
product paths loaded through the real package root, actual Shell and agentCommands.

| Evidence | Native PRIMARY | Host rows | Invalid guards |
| --- | --- | --- | --- |
| `pre-ready-red.json`, first harness | 14/15 | 8/10 | 0/25 |
| `pre-ready-corrected.json`, harness-only corrections | **14/15** | **9/10** | **0/25** |

Historical raw comparison also remains14/15. Both profiles' sole native loss is
entry ordering: fresh native `/usr/bin/env` emits `A=1\nB=2\n`, while product
emits `B=2\nA=1\n`; both have status0, empty stderr and identical effects.
No ordering normalization or source sorting fix is proposed. Curie's earlier
benchmark profile captured the opposite native order (B,A); that historical
fact is retained, not silently rewritten into this different launch profile.

The remaining host row is shared-output accounting. With maxOutputBytes10 and
intended recursive replacement-invoked `tick` writing four bytes per call, the
frozen witness expects three intended dispatches, eight delivered bytes, then
ShellLimitError(maxOutputBytes). Actual:two dispatches, four delivered bytes
(`1234`), then the correct typed limit error. This is not missing-command stderr
overflow: intended registry execution is independently witnessed.
**Route to root as a potential shared-output-accounting defect / contract
clarification**, not a demonstrated newly introduced replaceEnv regression.
The witness assumes delivered bytes count once; the approved additive contract
requires preserving shared budgets but does not independently specify counting
multiple forwarding-sink writes. No old-runtime comparison or source fix was made.
The frozen row remains red; no expectation is weakened to bless the observation.

All five budget subprobes were executed in the corrected run. Commands, depth,
source-byte and loop limits pass with intended registry witnesses. Output fails
as described. Cancellation preserves the exact caller FsError(ENOENT) identity,
and caller context observations remain unchanged. Function-local state after an
aborted whole exec is not directly inspectable; success/failure locals and export
attributes are covered separately. Literal args and middleware are witnessed.

## Transparent harness corrections

The first host middleware awaited next without returning its CommandResult,
causing a false core-env reporter failure despite its exact KEEP-only map.
The corrected middleware returns next. Native setup now supplies its intended
environment directly rather than prepending `unset PUBLIC`; the actual original
recipe is executed unchanged. No frozen script or expected tuple was edited.
Budget subprobes now all execute before asserting, rather than stopping after
the output failure. Manifests are canonically keyed by digest:the corrected
25-row evidence reuses **two unique manifests** rather than repeated full maps.
The initial flawed-harness observations remain immutable and are not acceptance.

## Native tool identity and limits

PRIMARY GNU5.3 SHA256:
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
HISTORICAL Bash3.2 SHA256:
`35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
Both outer shell profiles use Apple `/usr/bin/env`, SHA256
`9eb7c5aed7f3c7fe07b77d9a84d0a7c6a8c68c17a15aa3dace0d8ff02d352776`;
this is NOT a GNU-coreutils env claim. Explicit child Bash/sh paths ensure their
profile selection despite env-i clearing PATH. The bare nested-env original
instead uses system default search, not an injected profile shim.

The auxiliary `env -i /usr/bin/which env` control exits1 and is inconclusive;
its failure is retained. `getconf PATH` and candidate-file audit are recorded in
endpoint.json, but are not a traced execvp proof. No claim that a profile PATH
shim survives env-i is made. Exact native tuples remain raw and authoritative.

Focused compilation of `contract-types.ts` passes against the actual84fc742
CommandInvokeOptions and real CommandContext.invoke types, with stable source
guard. This is not a callback-only implementation proof: all product rows use
real Shell+agentCommands. No full suite, old9/custom5/BOM/jq/expanded7 reruns,
source edit, additional dependency, skip or xfail. Prior current-shell and
expanded comparison snapshots are untouched.

Reproduce after root supplies exact READY:
`node tests/shell-stress/env-replacement/replay.mjs ready-REVISION.json`.
Existing evidence refuses overwrite. Do not alter cases/native expectations.
Use recorded actual import manifests to qualify foreign/moving-source changes;
never blindly retry an invalid run. This leaf stops at preparation/red evidence.

Final endpoint qualification:after the recorded product/type runs, foreign
`src/fs/s3/authority.ts`, `src/fs/s3/filesystem.ts`,
`src/fs/webdav/resource-id.ts` and `src/fs/webdav/webdav.ts` changed. Exact old
and current hashes are in endpoint.json. Per-row measured guards remain valid,
but no current-tree or later-dependency acceptance follows; no retry was made.
The endpoint explicitly checked84 recorded native/product/type PIDs and groups,
all absent. The auxiliary getconf child also completed normally. Owned temporary
directories were removed; no watcher/SIGSTOP or child remains running.
