# Synchronous runner timeout reproduction

Revision: `f314e261c96e444b8fc983117864462171db5bc4` with the initial runner qualification working-tree changes, before process isolation. Node `v22.23.2`, ICU `78.2`.

Pinned upstream fixture: `built-ins/Array/prototype/push/S15.4.4.7_A3.js`, Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`. Its `esid` is `sec-array.prototype.push`. The fixture sets an array length to 4,294,967,295, checks a zero-argument push, then checks that pushing one value creates property `4294967295` and throws `RangeError` when setting the length. This fixture is specification evidence; the native control below does not replace that contract.

Smallest observed blocking input:

```js
/*---
flags: [raw]
---*/
const x=[];
x.length=4294967295;
x.push();
```

Reproduction command shape, executed from repository root:

```sh
node --import tsx --input-type=module -e 'import {executeTest262} from "./packages/safe-js/test/conformance/execute.ts"; console.log(JSON.stringify(await executeTest262("probe.js", "/*---\nflags: [raw]\n---*/\nconst x=[];x.length=4294967295;x.push();", {harness:new Map(),timeoutMs:3000})));'
```

An independent Python `subprocess.run(..., capture_output=True, text=True, timeout=7)` supervisor executed this command and killed it after **7.018 seconds**. It emitted no stdout or stderr. Expected runner contract: a failed timeout result after the configured 3,000 ms bound. Actual: the in-process event-loop timer could not run, and neither timeout nor final result was emitted.

Neighboring passing control changes only the length to `1024`: exit 0 in **0.875 seconds**, result `{kind:"test",results:[{mode:"raw",status:"passed"}]}` with the same 3,000 ms bound.

Disposition: the inability to enforce a timeout is a **runner defect**, owned by process orchestration. The underlying sparse-array operation requires separate runtime/performance investigation and was not repaired here. Budgets and timeout values were not increased to obtain a pass. The repair introduces an external worker supervisor which can kill a blocked worker, records the selected variant as a nonpass, then restarts for the next variant.

Worker transport TDD:

- `npx vitest run packages/safe-js/test/conformance/execute.test.ts`: new mode-selection regression initially 1 failed / 24 passed; requesting strict ran both sloppy and strict.
- `npx vitest run packages/safe-js/test/conformance/worker.test.ts`: initially failed import because the worker implementation did not exist.
- `npx vitest run packages/safe-js/test/conformance/{execute,worker}.test.ts`: green, **32 passed / 2 files**, exit 0, **4.00 seconds**; worker tests execute in 6 ms and guest tests in 799 ms.

The ongoing maintained package run began before these worker files existed. Its eventual receipt must not be presented as qualification of the new process supervisor; focused post-repair tests and externally bounded pinned-fixture execution provide that evidence separately.
