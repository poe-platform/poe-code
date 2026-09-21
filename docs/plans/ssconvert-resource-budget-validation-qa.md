# Resource-budget validation follow-up QA

This follow-up audits the supplied implementation without treating historical results as verification of the current candidate. Preserve existing edits, README files, parent environment and resources; do not commit, push or publish user-owned untracked implementation.

## Manual procedure

1. Verify the already acquired primary source archive in `out/ssconvert-lifecycle` against SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Inspect the captured dependency/plugin/locale profile in `docs/ssconvert/calculation-current-native-profile.json`. Native execution remains a separate oracle and is not needed for these deliberate host refusals.
2. Reproduce invalid command-output budget acceptance using original in-memory tests before changing engine validation. Have a different agent independently stress terminal byte boundaries, empty producer amplification and cleanup settlement, with negative controls.
3. Reproduce empty-producer amplification through the actual Shell with an injected provider; require explicit host refusal, settled producer cleanup, no importer calls and unchanged namespace after repair.
4. After source stabilization run the maintained uncached safe-bash workspace build closure, fresh complete ssconvert workspace unit tests, and its maintained lint route. Run the complete safe-bash ssconvert command family through Node/tsx and lint the integration source and command family. These focused cross-workspace checks cover this admission repair; they do not constitute repository-wide gates.
5. Execute a built public Shell invocation whose provider yields five empty chunks with `workbookWork:4`. Capture its diagnostic using the shared screenshot renderer into `out`; inspect spacing, exact host-refusal wording and absence of a stack trace, then remove generated evidence.
6. Record final product/test source hashes and outcomes. Distinguish initial failing regressions, final passes, unavailable runtime/oracle/realm cells, and unmeasured allocations/performance. Do not count overlapping suites twice or call focused reruns broad-gate passes.

## Initial evidence

Five invalid-value cases (`NaN`, infinity, negative, fractional and unsafe integer) failed because `createEngine` accepted `commandOutputBytes`; all five passed after adding it to existing SDK validation. Before rebuilding the empty-chunk repair, the public Shell regression produced `Loading file:///input.fixture failed` instead of the expected host resource refusal. The independent reviewer separately reproduced empty-chunk read amplification before repairing it.

The archive hash matched. The existing reference profile captures Gnumeric 1.12.61 on Linux aarch64, dependency versions, plugin identity and locale settings. No native oracle was run in this follow-up.

## Outcomes

A pre-empty-chunk-repair run passed all 311 ssconvert files / 6240 cases and its maintained lint route. Its uncached safe-bash dependency build closure passed. Those results are interim and do not verify the subsequent source repair.

After source stabilization, final fresh complete `npm run test --workspace=@poe-code/ssconvert` passed 312 files / 6248 tests in 128.47 seconds, with no skips or failures. The maintained workspace lint route passed source ESLint plus source/test/public-consumer TypeScript checks. The selected uncached `@poe-platform/safe-bash` maintained build closure passed, including ssconvert and native npm postbuild stages. The complete safe-bash ssconvert command family passed 118/118 tests, zero failures/skips/cancellations, in 18.71 seconds. Integration source and complete command-family ESLint passed. The independent 40-case focused cohort overlaps these totals and is not additive. No final gate failed, timed out or remained incomplete.

Manual public built-Shell screenshot inspection passed: the command emitted exactly `ssconvert input chunks limit exceeded` with normal spacing and no stack trace. The intentional command exit was 1; the screenshot renderer completed successfully. Its generated PNG was removed after inspection. An additional current-process cross-realm `Uint8Array` source test passed exact owned bytes, unchanged producer bytes, exact input-byte admission and one-chunk-over refusal. This single VM realm case does not establish hostile-host isolation or the full runtime matrix.

The repaired behavior remains SDK configuration: invalid command-output limits are rejected on engine construction; yielded input chunks are bounded by explicit `workbookWork`, otherwise `max(1, remaining input byte allowance)`, before retained allocation. EOF consumes no yielded-chunk allowance, and empty chunks are not retained. Cooperative producer cleanup settles before exposing the refusal. No new CLI flags were added. Product and fixture hashes below were checked after final execution and remained unchanged. No fixture randomness was used; the minimized amplification case is five empty yields with a four-chunk allowance.

Local commits: none; existing user-owned untracked implementation was preserved without staging. Remote-main delivery and releases: neither attempted, as requested. No README files were edited. Existing primary source and historical evidence under `out` were preserved; only this follow-up's generated screenshot was removed.

## Explicit limitations

Neither these semantic checks nor the prior tests establish a JavaScript allocator/RSS cap, arbitrary host preemption, rollback of completed writes, exhaustive abort phases, every format allocation path or full Gnumeric parity. Runtime cells outside the current host, native differential execution, all cross-realm/checkpoint/replay combinations and bounded performance measurements remain unverified by this follow-up. Existing complete-family tests exercise their particular persisted-workbook replay and authority cases only. Repository-wide `npm test`, lint and root build are not claimed by the focused admission repair.

## Candidate identity

Execution host: Node v22.22.2, Darwin arm64. Base HEAD: `b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`. The candidate is the authorized dirty live worktree, including pre-existing untracked package inputs; HEAD alone does not identify it. These SHA-256 values identify the scoped product/fixture inputs, not an immutable complete-repository archive:

| Input | SHA-256 |
| --- | --- |
| packages/ssconvert/src/engine.ts | 5ff85fd43e87d1312def054884d6b69d6d260683b6d7eea5f9fa93fef11706c6 |
| packages/ssconvert/src/contracts.ts | 56c5750e29e72ed01c653817d34a65fae35192d407e85817c69ca7f775ef5774 |
| packages/ssconvert/src/resource-budgets.test.ts | a967dca9eac573d1abdff11d9832d92e5faa186e8518c7f40371d885c50a08a9 |
| packages/ssconvert/src/resource-budget-validation-review.test.ts | a0bcfe2fcf938fa976cbfab622e1052b1074a267349bf8b0682e19c032ae1dd3 |
| packages/safe-bash/src/commands/ssconvert/index.ts | 986895554efa1a8dca44e664307112c8638562be7080f08b18082f5ceaf1caa4 |
| packages/safe-bash/tests/commands/ssconvert-resource-budgets.test.ts | ee2dcca85649431949ea210af909961bcd58defb173be31bf1db5b3aa53966e9 |
