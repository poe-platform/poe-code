# Non-agent shared-memory admission redelivery — 2026-09-14

Task acceptance remains **OPEN**. This maintained conformance integration change
admits shared-memory fixtures that do not require child agents. It does not grant
blocking authority or claim upstream agent coverage.

Parent source: `711f06c1c5e291c29d58c801f637d7d26960ea9d`. The unchanged three
regression cases from local `e0b768833` reproduce two failures against that source:
Number/BigInt operations and CanBlockIsFalse are incorrectly excluded. The
CanBlockIsTrue unsupported control passes. Red run: two failed, one passed.
Applying the original runner patch gives **254 passed / 18 files**, no skips or
failures, across the complete maintained conformance-runner unit directory.
Scoped ESLint and package typecheck pass. The two old unconditional-exclusion
rows are replaced by concrete operation/nonblocking assertions, while the blocking
and agent exclusions remain tested. No runtime implementation, public API,
budget, assertion strength, timeout or support floor is changed.

Node22.23.2 / ICU78.2 / V8 12.4.254.21-node.56, Darwin arm64. Target remains
ECMA-262 edition16 and ECMA-402 edition12 (June2025), plus explicitly tracked newer
APIs. Test262 checkout is clean at `419d3e0a2273ba01a3bfcbec423f2801425b8e93`.

```sh
npx vitest run packages/safe-js/test/conformance/shared-memory.test.ts
npx vitest run packages/safe-js/test/conformance
npx eslint packages/safe-js/test/conformance/execute.ts packages/safe-js/test/conformance/execute.test.ts packages/safe-js/test/conformance/shared-memory.test.ts
npx tsc --noEmit -p packages/safe-js/tsconfig.json
npm run test:conformance --workspace=@poe-code/safe-js -- --corpus /tmp/qualify-shared-memory-test262 --include built-ins/SharedArrayBuffer --include built-ins/Atomics --timeout-ms 3000 --report /tmp/poe-code-qualify-shared-memory-delivery/docs/plans/qualify-shared-memory/non-agent-admission/upstream.jsonl
```

Use a new report path on reproduction; the maintained command refuses overwrite.
Local unit/type/lint work completed before upstream execution. The upstream
selection uses its existing persistent child process and kill/replace boundary,
3,000ms per-variant wall deadline starting before dispatch, and unchanged default
budgets. No case is retried, omitted or relabeled to force an all-pass summary.

[Complete upstream stream](upstream.jsonl): **493 files, 986 variants; 730 passed,
18 failed, 238 unsupported**, zero metadata/execution errors. Exit **1** is
retained. Unsupported counts are **224 agent** and **14 blocking-mode**. The 18
failures are the two modes of nine `immutable-buffer.js` Atomics fixtures, tagged
`immutable-arraybuffer`. Their pinned `testTypedArray.js` only installs the
immutable factory when `ArrayBuffer.prototype.transferToImmutable` exists;
otherwise it throws `no arg factories match include immutable and exclude
undefined` before the intended Atomics assertions. These remain explicit newer-API
integration failures, not passing ECMAScript16 coverage or skipped assertions.
The target and newer-API ledger are not redefined around them.

The report's sourceSha is the parent with this candidate applied; its sourceHash
covers the exact runtime/build/conformance sources, including the candidate.

Candidate sourceHash: `2836670004bce27933e84a2bab24315c95c4327f9ce3365810c4ce291cd44b76`.

`packages/safe-js/test/conformance/execute.ts` SHA-256: `cb1f9089450e84c0451d2f1b4ee79cfe7b7c0c51d2b3325db171a2c97772e396`.

`packages/safe-js/test/conformance/execute.test.ts` SHA-256: `a70a349f67028b08948f9ce190c40e05fbce5ca01b90bd231bdf344ac8e94268`.

`packages/safe-js/test/conformance/shared-memory.test.ts` SHA-256: `396916268f39cfb139bae67176d97e440c2587d96c6495770fdce5ef4cc99b30`.

The enclosing test/conformance commit delivers this admission repair separately
from runtime repairs and release receipts. Source helper files are not part of
the published runtime exports. Any triggered scoped publication and root workflow
are still verified independently; a successful unit gate does not complete the
upstream selection or the overall task. Raw/legacy shared-history rejection,
agent execution and outstanding runtime/edition cells remain blockers.
