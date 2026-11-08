import { expect, it } from "vitest";
import { executeTest262 } from "./execute.js";

const harness = new Map([["assert.js", ""], ["sta.js", ""]]);

it("executes shared integer and BigInt operations without requiring an agent fixture", async () => {
  const source = `/*---
flags: [onlyStrict]
features: [SharedArrayBuffer, Atomics, BigInt]
---*/
const b = new SharedArrayBuffer(16);
const i = new Int32Array(b);
const n = new BigInt64Array(b, 8);
if (Atomics.add(i, 0, 7) !== 0 || Atomics.load(i, 0) !== 7) throw new Error("integer");
if (Atomics.exchange(n, 0, 9n) !== 0n || Atomics.load(n, 0) !== 9n) throw new Error("bigint");`;
  expect(await executeTest262("shared.js", source, { harness, timeoutMs: 1000 }))
    .toMatchObject({ results: [{ mode: "strict", status: "passed" }] });
});

it("qualifies the nonblocking host agent without permitting Atomics.wait to suspend", async () => {
  const source = `/*---
flags: [onlyStrict, CanBlockIsFalse]
features: [SharedArrayBuffer, Atomics]
negative: {phase: runtime, type: TypeError}
---*/
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Infinity);`;
  expect(await executeTest262("cannot-block.js", source, { harness, timeoutMs: 1000 }))
    .toMatchObject({ results: [{ mode: "strict", status: "passed" }] });
});

it("executes a blocking agent requirement with an immediate comparison failure", async () => {
  const source = `/*---
flags: [onlyStrict, CanBlockIsTrue]
features: [SharedArrayBuffer, Atomics]
---*/
if (Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 1, Infinity) !== "not-equal") throw new Error("wait comparison");`;
  expect(await executeTest262("can-block.js", source, { harness, timeoutMs: 1000 }))
    .toMatchObject({ results: [{ status: "passed" }] });
});
