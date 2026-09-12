# Runner hard wall isolation repair

The first corpus attempt exposed a concrete runner defect: `built-ins/Array/prototype/push/S15.4.4.7_A3.js` remained synchronously busy beyond the configured 3,000 ms timeout. A cooperative Promise.race timer could not preempt that native-host work. See `hard-timeout-reproduction.json` for the unchanged pinned fixture, reduced trigger, external 6-second termination, and passing neighboring control. The first cohort is incomplete/superseded evidence; none of its passes may be mixed into the replacement baseline.

This repair is runner orchestration only. It does not change Array.push, runtime semantics, feature budgets, guest assertions, host capabilities, or the original 3,000 ms variant timeout.

## Resulting contract

- Each corpus selection owns one reusable child process; each variant starts in its existing fresh sandbox realm.
- The child must become ready within a separately recorded 10,000 ms startup allowance. This does not extend a variant deadline.
- The parent starts the 3,000 ms hard wall timer **before request dispatch**, so absent or delayed start acknowledgements cannot evade it.
- Ready/started/result messages carry request identities and matching variant modes. Exactly one start acknowledgement is required; stale or malformed messages, premature process exits, and startup failures produce explicit nonpasses.
- A hard timeout kills the child, records the current variant once as `failed/timeout` with `worker-wall-timeout`, and starts a replacement for the next variant. It does not retry the failed variant for a more favorable result.
- Corpus cleanup terminates the retained worker, including on output failure. Advanced IPC serialization preserves configured Date deadlines rather than silently converting them to strings.
- The manifest records isolation mechanism, startup allowance, unchanged wall timeout, dispatch boundary, and recovery rule.

## TDD and checks

Source SHA remains `f314e261c96e444b8fc983117864462171db5bc4`; the source-content identity changes and therefore requires a new manifest. Environment: Node `v22.23.2`, ICU `78.2`, V8 `12.4.254.21-node.56`.

`npx vitest run packages/safe-js/test/conformance/isolate.test.ts` first failed because the new boundary did not exist (23:33:35 local), then passed 7 in-memory mocked-worker tests (23:34:19). Additional regressions reproduced acceptance of invalid timeout values and a pass without a started acknowledgement: 5 failed / 7 passing controls at 23:35:06. The repaired boundary passed all 12 tests at 23:35:38. No unit test creates a real child or writes fixture files.

Final checks:

- `npx vitest run packages/safe-js/test/conformance`: 140 passed across 10 files, 4.79 seconds, exit 0.
- `npx tsc --project /tmp/safejs-conformance-tsconfig.json --noEmit --pretty false`: focused conformance/import-closure strict TypeScript check, exit 0. The temporary config preserves root compiler settings and resolves the same Node/Vitest types explicitly from the repository.
- Focused ESLint over isolate/corpus/command and their tests: exit 0, no warnings.
- `git diff --check -- packages/safe-js/test/conformance`: exit 0.

## Real pinned-fixture smoke

Executed through the maintained npm command, with real child processes and the actual pinned harness:

```sh
npm run test:conformance --workspace=@poe-code/safe-js -- \
  --corpus /private/tmp/safejs-baseline-test262-419d3e0 \
  --include built-ins/Array/prototype/push/S15.4.4.7_A3.js \
  --include built-ins/Array/prototype/push/S15.4.4.7_A4_T1.js \
  --timeout-ms 3000 \
  --report /Users/kjopek/Workspace/poe-code/docs/plans/complete-conformance-runner/isolation-smoke.jsonl
```

Result: A3 produced two explicit hard wall timeout nonpasses; the following A4_T1 produced two passes after worker replacement. The mandatory final summary accounts for 2 files / 4 variants / 2 passes / 2 failures, with no unsupported or file-level errors. Exit 1 is required and was observed. Source verification succeeded before and after, under manifest `9436612867dbba331f104f0d3cd8e7f6f649e972fcdc695b21f25d87b53c0c94`. The command finished at `2026-09-12T04:36:33.633Z`; a subsequent process-list inspection found no remaining conformance worker child.

The complete replacement corpus run must use its fresh baseline-v2 manifest and newly executed selections exclusively. This smoke qualifies recovery and accounting; it is not the complete corpus result.
