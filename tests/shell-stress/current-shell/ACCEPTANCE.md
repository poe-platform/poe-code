# Bounded source/dot/eval independent acceptance

**Accepted on the recorded tested dependency snapshot, not the later moving tree.**
READY source commit: `489c8b7cd8f18988a5ddf53838795265adf270ad`.
The handoff explicitly relinquished the source lease; its committed shell tree
and runtime bytes matched before product execution and every subsequent phase.
READY arrived within the single bounded 180-second wait. No product ran earlier.

The completed measured batch ran August 27, 2026, 02:32:34–02:33:09 UTC.
Frozen `0934888`/`42baad3` cases, native expectations, host witnesses, product
driver and earlier red artifacts remained byte-identical. No source, shared
contract, manifest, foreign test or expectation was edited by this leaf.

## Independent results

| Cohort | Fresh result |
| --- | --- |
| Unchanged independent native semantics, PRIMARY GNU5.3 | **32/32 exact** |
| Same entire independent cohort, HISTORICAL Bash3.2 | **26/32 exact** |
| Separate unchanged host contracts | **11/11** |
| Actual loaded-path/hash guards for independent rows | **43/43 valid** |
| Fresh actual native GNU5.3 capture vs original freeze | **32/32 identical** |
| Fresh actual native Bash3.2 capture vs original freeze | **32/32 identical** |
| Original invocation holdouts | **72/72** |
| Original invocation author tests | **132/132** |
| Source/dot/eval author tests | **86/86** |
| New diagnostic author tests | **48/48** |
| Prior invocation-closure author tests | **211/211** |
| Fresh virtual original57 vs existing whole GNU5.3 capture | **51/57 raw exact** |
| Fresh virtual original57 vs existing whole Bash3.2 capture | **49/57 raw exact** |

The two routed defects now pass unchanged: sourced-directory diagnostic and
missing-command diagnostic after Bash child isolation. There are no new in-scope
source findings. Historical six-of-32 differences stay in the denominator.
Original57 losses retain exactly the same six/eight IDs as the previous
51/57 +49/57 checkpoint; this was measured, not assumed. The comparison correctly
exits 1. Its exact raw status, stdout/stderr hex and effects are preserved.
Existing registry commands remain registry commands, not relabeled builtins.

The author's historical diagnostic12/48 and earlier source/eval historical
differences remain separate prior evidence, not fresh independent green results.
The new author test file asserts its PRIMARY48 expectations; this table does not
reclassify its entire historical cohort as passed. Native profile selection is
always GNU5.3 PRIMARY and Bash3.2 HISTORICAL, never selected case by case.

## Native provenance and comparison reuse

Both full32 native profiles were actually rerun once with fresh isolated native
directories, scrubbed environments, pinned binaries, recorded argv0/argv/locale,
8-second process-group deadlines and exact output/effect captures. Every result
matches its corresponding original capture. No new normalization was added:
the original frozen native-temporary-root mapping to `/fixture` remains the only
declared coordinate mapping, with original raw bytes retained alongside it.

GNU5.3 binary SHA256:
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
Historical3.2 binary SHA256:
`35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.

Original57 comparisons reuse the existing invocation-closure `compare.ts`
algorithm unchanged, including its TAP stdoutHex transport decoding and native
change accounting. `acceptance-compare.mjs` replaces only the helper import for
the owned evidence-output adapter, then transpiles with existing development
TypeScript. The original/adapted hashes and exact adapter are recorded. No files
in invocation-closure were changed. The native57 references were not recaptured;
fresh virtual results come from the unchanged72 holdout execution.

## Guards and important later drift

Tested runtime SHA256:
`e886b64536c7496769fdbe856aafb0e73ee88ace47c2a3ca9cb3cc71f11f8c4a`.
Tested static transitive source graph SHA256:
`d98c01c353dfde4b203f4c93306c8b84ce7db98e102eb0c0e8b65fce1220cc51`.

Each runtime phase observes **34 actual imported product paths**. Fresh loader
hashes and before/after input snapshots match during every measured phase.
Independent43 has explicit per-child PID/load hashes checked against each row's
own pre/post source map, not merely an aggregate source scan. Legacy nested
children retain their existing path-only loader trace; those actual paths are
checked against the phase's pre/post hashes. These are endpoint observations,
not a lease, write/revert detector or clean-tree guarantee.

Global/build/benchmark noEmit each ran once after separately pre-enumerating
actual compiler inputs: **965/296/411 inputs**, all exit0, all stable during their
respective commands, no unguarded actual compiler input. No build emit or full
test suite was run. No retries sought a clean foreign dependency snapshot.

**After all measured phases**, the final endpoint audit found foreign changes:

- `src/commands/execution.ts`: tested
  `b156ba98bd7cbd100ad3b3fab3f0c42612ffda30039fded8f6951c12776539de`, then
  `48f7c66074049ee4b4afc9a1b009102cab07a663b67ba5e52ab47c4cae4c0865`.
- `src/contracts/command.ts`: tested
  `997422b9774ba15d385a1ff10156540a3f562f5a42607ae56c6186d78ff500cd`, then
  `1ec2f2907eb123ea366623bda293249a62bad6886a63bebb957930df0d414ffa`.
- Global compiler input `tests/contracts/invoke.test.ts` also changed; exact old
  and current hashes are in `acceptance-endpoint-489c8b7.json`.

The shell runtime remains at READY. These later writes do not retroactively
erase measured per-run stability, but **no result certifies the later dependency
tree**. Acceptance is explicitly bounded to the recorded source/dependency
snapshot. No retry or foreign correction followed the endpoint finding.

## Harness recovery and limits

The initial43 attempt also reported43 passes with stable actual imports, but
artifact writing failed because the scrubbed runner PATH omitted `apply_patch`.
That complete phase log is immutable. The evidence-tool path was made explicit,
and exactly one documented infrastructure-recovery repeat produced
`ready-diagnostics-489c8b7.json`. This was not a product failure, expectation
change or retry after foreign guard drift. Instrumentation only adds optional
actual-load tracing and PID evidence; frozen host witnesses are unchanged.

The original red16/32 +4/11, initial false-positive5/11, and later30/32 +11/11
artifacts remain intact. No skip, xfail, TODO, expectation weakening or changed
recipe was used. No old9 historical diagnostics, custom5 first-read lifecycle,
NUL-blocked probes, expanded7 harness or broad jq cohort was rerun.
The independently recorded BOM64/64 checkpoint is not duplicated here.

Final audit checked **243 recorded owned PIDs and process groups**, all absent;
owned native/acceptance temporary directories are removed. No SIGSTOP or watcher
remains. Foreign processes and worktree/index changes are outside this claim.

This is a **bounded source/dot/eval independent checkpoint**, not full Bash,
overall kernel/native parity, broader backend completion or superiority.
Machine-readable overview: `acceptance-summary-489c8b7.json`; endpoint
qualification: `acceptance-endpoint-489c8b7.json`. Exact findings were routed to
`/tmp/safe-bash-current-shell-acceptance-findings.txt`; no source fix is requested.
