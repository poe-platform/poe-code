import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const seal = JSON.parse(fs.readFileSync(path.join(root, "DEFINITION-PRESEAL.json")));
assert.ok(Date.now() < Date.parse(seal.deadline));
for (const row of seal.inputs) {
  const filename = path.join(root, row.path), stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.size, row.bytes);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex"), row.sha256);
}
const coordinator = await import("./staged/new/coordinator.mjs");
const { completeWrite, durableJSON, clock } = await import("./staged/new/owner.mjs");
assert.equal(typeof coordinator.main, "function");
let calls = 0;
assert.equal(completeWrite({ writeSync() { calls++; return 1; } }, 1, Buffer.from("abc")), 3);
assert.equal(calls, 3);
assert.throws(() => completeWrite({ writeSync() { return 0; } }, 1, Buffer.from("a")));
const reasons = [undefined, false, 0, null, ""];
for (const reason of reasons) {
  let caught = false, closed = false;
  try {
    durableJSON({ openSync() { return 7; }, writeSync() { throw reason; }, fsyncSync() {}, closeSync() { closed = true; } }, "synthetic", {});
  } catch (error) { caught = true; assert.equal(error, reason); }
  assert.equal(caught, true); assert.equal(closed, true);
}
assert.throws(() => clock(Infinity));
const report = { status: "DEFINITION_AND_PURE_CONTROLS_PASS", coordinatorDefinitionImported: true, coordinatorMainCalled: false, predicates: 9, falsyReasons: 5, productImports: 0, children: 0, qualification: "Harness definition import only, no compiler/installer/retained/product/Worker activation" };
fs.writeFileSync(path.join(root, "DEFINITION-CONTROLS.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(report));
