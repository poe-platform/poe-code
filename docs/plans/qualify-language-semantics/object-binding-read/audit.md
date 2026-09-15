# Object-environment reads — 2026-09-13

ECMA-262 edition16 section9.1.1.2.6 requires HasProperty before GetBindingValue reads,
even after HasBinding found the property. SafeJS skipped that check and failed the
three recorded original fixtures. A getter can delete the binding between the checks;
strict reads must then throw ReferenceError, sloppy reads return undefined without Get.
The repair uses existing guest-aware property operations and preserves synchronous
lexical-binding reads. Host authority remains explicit.

Five independent semantic regressions fail in independent-red.log before the repair.
The initial red.log included native Node expectations that also fail: Node22.23.2 V8
omits the second lookup. green.log retains this oracle discrepancy. The pinned edition
text was fetched independently and saved in pinned-spec.txt; original Test262 cases
agree with it. One maintained virtual-binding test also used native behavior as oracle;
its expected sequence now explicitly includes the required extra lookup. No semantic
assertion was removed or weakened. The initial focused failure remains in focused.log.

```sh
npx vitest run packages/safe-js/src/interp/object-binding-read.test.ts
npx vitest run packages/safe-js/src/interp/object-binding-read.test.ts packages/safe-js/src/interp/with-binding-reference.test.ts packages/safe-js/src/interp/guest-proxy-with.test.ts packages/safe-js/src/snapshot/with-environment.test.ts packages/safe-js/src/snapshot/dynamic-with.test.ts packages/safe-js/src/interp/globals/eval-with-completion.test.ts packages/safe-js/src/interp/jobs.test.ts packages/safe-js/src/interp/global-scope.test.ts
npx eslint packages/safe-js/src/interp/interpreter.ts packages/safe-js/src/interp/object-binding-read.test.ts packages/safe-js/src/interp/guest-proxy-with.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
```

Final focused run passes52 tests/eight files, zero skips. Lint and build pass. Original
three fixtures and the recorded neighbor pass four/four variants in upstream-stable.jsonl.
The first enumeration aborted after the test-source correction, complete:false retained;
it is not a conformance result. Stable rerun occurred after build and source edits.
Exact commands, source SHA/fingerprint and fixture hashes/modes are recorded. Test262
419d3e0a2273ba01a3bfcbec423f2801425b8e93, Node22.23.2/ICU78.2, ECMA-262 edition16 and
ECMA-402 edition12 remain pinned, with unchanged3000ms/10000ms deadlines and budgets.

Built SDK tests pass Node18.18.0/ICU73.2,18.20.8/74.2,20.20.0/77.1,22.23.2/78.2,
24.14.0/78.2,26.8.2/78.3 and Bun1.3.11/74.2. Each checks three pending plus completed
replays, saved source and constructor host-escape denial. The inspected CLI screenshot
matches SDK lookup order. runtime-sdk.json and screenshot.log retain invocation/results.

Residual arithmetic becomes148 nonpasses. This focused repair does not complete the
language ledger or publication gates. Local commits, remote ancestry and actual package
publication remain separate receipts; shared dependency setup remains qualified.
