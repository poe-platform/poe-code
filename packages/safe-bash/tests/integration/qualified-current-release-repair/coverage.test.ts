import assert from "node:assert/strict";
import test from "node:test";

const { validateRuntimeCoverage, validateRuntimeResults } = await import(new URL("../../plugins/qualified-current-release/runtime-coverage.mjs", import.meta.url).href);
const { consumerGroups } = await import(new URL("../../plugins/qualified-current-release/consumers.mjs", import.meta.url).href);
const { verifyInventory } = await import(new URL("../../plugins/qualified-current-release/inventory-check.mjs", import.meta.url).href);
const canonical = { name: "canonical", files: ["tests/example.test.mts"], runtime: ["example.test.mjs"], nodeTests: 23 };
const counts = { tests: 23, pass: 23, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
const successful = () => [{ name: canonical.name, compile: "pass", runtimeResults: [{ runtime: "example.test.mjs", status: 0, counts: { ...counts } }] }];

test("all configured groups satisfy mandatory runtime coverage", () => validateRuntimeCoverage(consumerGroups));
test("self-contained atomic consumer has its own executable identity route", () => {
  const group = consumerGroups.find((entry: { name: string }) => entry.name === "webdav-atomic-independent");
  assert.deepEqual(group.files, ["tests/fs/webdav/atomic-extension-independent/consumer.mts"]);
  assert.deepEqual(group.runtime, ["consumer.mjs"]); assert.equal(group.consumerIdentity, true);
  const service = consumerGroups.find((entry: { name: string }) => entry.name === "webdav-atomic");
  assert.equal(service.files.length, 3); assert.deepEqual(service.runtime, []); assert.equal(service.companions, undefined);
});
test("valid results retain exact canonical assertion counts", () => validateRuntimeResults([canonical], successful()));
test("TLS-only noncanonical inputs can remain explicitly compile-only", () => {
  const group = { name: "tls", files: ["consumer.mts"], runtime: [] };
  validateRuntimeCoverage([group]); validateRuntimeResults([group], [{ name: "tls", compile: "pass", runtimeResults: [] }]);
});
test("empty canonical runtime list fails even without nodeTests metadata", () => assert.throws(() => validateRuntimeCoverage([{ ...canonical, runtime: [], nodeTests: undefined }]), /mandatory canonical/));
test("nodeTests without execution fails for noncanonical names too", () => assert.throws(() => validateRuntimeCoverage([{ ...canonical, files: ["consumer.mts"], runtime: [] }]), /nodeTests requires/));
test("identity-only consumer cannot become compile-only", () => assert.throws(() => validateRuntimeCoverage([{ name: "atomic", files: ["consumer.mts"], runtime: [], consumerIdentity: true }]), /requires execution/));
test("renamed canonical companion is mandatory", () => assert.throws(() => validateRuntimeCoverage([{ name: "renamed", files: [], companions: ["example.test.mts"], companionNames: ["holdout.test.mts"], runtime: [] }]), /mandatory canonical/));
test("runtime must resolve to a declared input", () => assert.throws(() => validateRuntimeCoverage([{ ...canonical, runtime: ["example.test.mjs", "missing.mjs"] }]), /no input/));
test("duplicate runtime cannot manufacture extra execution", () => assert.throws(() => validateRuntimeCoverage([{ ...canonical, runtime: ["example.test.mjs", "example.test.mjs"] }]), /duplicate runtime/));
for (const count of [0, -1, 1.5, NaN]) test(`invalid nodeTests ${count} fails before execution`, () => assert.throws(() => validateRuntimeCoverage([{ ...canonical, nodeTests: count }]), /invalid nodeTests/));
test("compiled but unexecuted canonical results fail after execution phase", () => assert.throws(() => validateRuntimeResults([canonical], [{ name: canonical.name, compile: "pass", runtimeResults: [] }]), /not executed/));
test("missing actual test counts fail after execution phase", () => {
  const result = successful(); delete (result[0]!.runtimeResults[0] as { counts?: unknown }).counts;
  assert.throws(() => validateRuntimeResults([canonical], result), /missing runtime test count/);
});
for (const key of ["tests", "pass", "fail", "cancelled", "skipped", "todo"] as const) test(`mutated actual ${key} cannot pass`, () => {
  const result = successful(); result[0]!.runtimeResults[0]!.counts[key]++;
  assert.throws(() => validateRuntimeResults([canonical], result));
});
test("nonzero runtime status is not a completed consumer", () => {
  const result = successful(); result[0]!.runtimeResults[0]!.status = 1;
  assert.throws(() => validateRuntimeResults([canonical], result), /runtime failed/);
});
test("inventory rejects a new executable under the former excluded prefix", () => {
  assert.throws(() => verifyInventory({ entries: [], counts: {} }, ["tests/integration/stream-five-public/new.test.mts"], [], [], () => { throw new Error("unexpected read"); }), /standalone inventory changed/);
});
