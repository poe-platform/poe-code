import { expect, it } from "vitest";
import { executeTest262 } from "./execute.js";

it("shares growth through repeated broadcasts and preserves existing fixed and tracking views", async () => {
  const source = `/*---
flags: [onlyStrict]
includes: [atomicsHelper.js]
features: [SharedArrayBuffer, Atomics, BigInt, resizable-arraybuffer]
---*/
function report() {
  let value;
  while ((value = $262.agent.getReport()) === null) $262.agent.sleep(1);
  return value;
}
$262.agent.start(\`
  $262.agent.receiveBroadcast(function(buffer) {
    const tracking = new BigInt64Array(buffer);
    const fixed = new BigInt64Array(buffer, 0, 1);
    $262.agent.report("views-created");
    $262.agent.receiveBroadcast(function(alias) {
      alias.grow(16);
      Atomics.store(tracking, 1, 11n);
      $262.agent.report([buffer === alias, buffer.byteLength,
        tracking.length, fixed.length, Atomics.load(new BigInt64Array(alias), 1)].join(","));
      $262.agent.leaving();
    });
  });
\`);
const buffer = new SharedArrayBuffer(8, { maxByteLength: 16 });
const tracking = new BigInt64Array(buffer);
const fixed = new BigInt64Array(buffer, 0, 1);
$262.agent.broadcast(buffer, 0);
if (report() !== "views-created") throw new Error("missing view creation acknowledgement");
$262.agent.broadcast(buffer, 0);
if (report() !== "false,16,2,1,11") throw new Error("worker growth aliases");
if (buffer.byteLength !== 16 || tracking.length !== 2 || fixed.length !== 1 ||
    Atomics.load(tracking, 1) !== 11n || Atomics.load(fixed, 0) !== 0n)
  throw new Error("parent growth aliases");`;
  expect(await executeTest262("growth-agents.js", source, {
    harness: new Map([["assert.js", ""], ["sta.js", ""], ["atomicsHelper.js", ""]]),
    timeoutMs: 3000
  })).toEqual({ kind: "test", results: [{ mode: "strict", status: "passed" }] });
});
