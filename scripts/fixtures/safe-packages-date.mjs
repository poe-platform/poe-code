import assert from "node:assert/strict";
import { deepCopyFromSandbox, dump, restore } from "@poe-platform/safe-js";
import { createRealm, lint, run } from "@poe-platform/safe-js/core";

let reads = 0;
const clock = {
  now: () => {
    reads++;
    return 1234;
  },
  snapshot: () => ({ next: 1235 })
};
const source = `
  const jquery = { now: Date.now };
  const initialized = +new Date;
  const date = new Date(0);
  const alias = date;
  date.setUTCFullYear(2024, 1, 29);
  return [jquery.now(), initialized, date, alias, new Date(NaN),
    date instanceof Date, Object.getPrototypeOf(date) === Date.prototype,
    new Date(0).toISOString(), JSON.stringify(new Date(NaN))];
`;
assert.deepEqual(lint("Date.now(); +new Date; new Date(0).toISOString();"), []);
const first = await run(source, { clock });
assert.equal(first.ok, true);
assert.equal(reads, 2);
const snapshot = JSON.parse(await dump(first));
const tampered = structuredClone(snapshot);
tampered.replay.calls[0].outcome.data.root = "invalid clock value";
await assert.rejects(run(source, { snapshot: restore(tampered, { source }) }), /Date clock/);
const replayed = await run(source, {
  snapshot: restore(snapshot, { source }),
  clock: {
    now: () => {
      throw new Error("Clock must not be reread during replay");
    },
    snapshot: () => undefined
  }
});
assert.equal(replayed.ok, true);
const values = deepCopyFromSandbox(replayed.returnValue);
assert.deepEqual(values.slice(0, 2), [1234, 1234]);
assert.equal(values[2], values[3]);
assert.equal(values[2].toISOString(), "2024-02-29T00:00:00.000Z");
assert.equal(Number.isNaN(values[4].getTime()), true);
assert.deepEqual(values.slice(5), [true, true, "1970-01-01T00:00:00.000Z", "null"]);

const realm = createRealm({ clock });
try {
  await realm.evaluate("const date = new Date();");
  const result = await realm.evaluate(
    "date.setTime(date.getTime() + 1); return date.toISOString();"
  );
  assert.equal(result.ok, true);
  assert.equal(result.returnValue, "1970-01-01T00:00:01.235Z");
} finally {
  await realm.close();
}
console.log(
  "Public Date construction, reported jQuery expressions, realm mutation and clock replay passed"
);
