import assert from "node:assert/strict";
import { join } from "node:path";

export const targetIds = ["target-public-0", "target-direct-0", "target-public-1", "target-direct-1"];
export const validIds = ["valid-public", "valid-direct"];
const units = args => args.map(value => Array.from({ length: value.length }, (_, index) => value.charCodeAt(index)));
export function validate(record, spec) {
  const boundary = spec.id.includes("direct") ? "direct" : "public", valid = spec.id.startsWith("valid-");
  const variant = valid ? null : Number(spec.id.at(-1));
  const input = valid ? ["7"] : [spec.original, ...spec.original.variants][variant].args;
  const expectedCalls = !valid && variant === 0 && boundary === "public" ? 0 : 1;
  const diagnostic = valid ? "" : variant === 1 ? "expr: argv must contain well-formed Unicode\n" : boundary === "public" ? "shell: line 1: invoke requires a command and literal string arguments without NUL\n" : "expr: NUL is not supported in argv\n";
  assert.equal(record.id, spec.id); assert.equal(record.boundary, boundary); assert.equal(record.variant, variant);
  assert.deepEqual(record.inputCodeUnits, units(input)); assert.deepEqual(record.commandCodeUnits, units(["expr"])[0]);
  assert.equal(record.invocations, expectedCalls); assert.equal(record.wrapperInvocations, boundary === "public" ? 1 : 0);
  assert.deepEqual(record.seenArguments, expectedCalls ? [units(input)] : []);
  assert.deepEqual(record.identity, { rootLeafFactory: true, forwarded: expectedCalls ? [{ handler: true, receiver: true, context: true, signal: true }] : [] });
  assert.equal(record.cleanupSettled, true); assert.equal(record.error, undefined);
  assert.equal(record.workerMetrics.workerCreations, 0); assert.deepEqual(record.observer.workers, []);
  assert.deepEqual(record.result, { exitCode: valid ? 0 : expectedCalls ? 2 : 1, stdoutHex: valid ? "370a" : "", stderrHex: Buffer.from(diagnostic).toString("hex"), diagnostic });
  for (const suffix of ["dist/index.js", "dist/commands/expr/index.js", "dist/shell/runtime.js"]) {
    const path = join(spec.consumer, "node_modules/virtual-bash", suffix);
    assert.ok(record.actualLoads.some(load => load.path === path && load.sha256 === spec.packageFiles[suffix]), `required path/hash ${path}`);
  }
  for (const load of record.actualLoads) assert.equal(load.sha256, spec.expected[load.path], load.path);
  return { status: "pass", boundary, variant, invocations: expectedCalls };
}
export const mutations = [
  ["wrong-status", record => { record.result.exitCode = record.result.exitCode === 1 ? 2 : 1; }],
  ["wrong-dispatch", record => { record.invocations = record.invocations === 0 ? 1 : 0; }],
  ["wrong-diagnostic", record => { record.result.diagnostic += "wrong\n"; record.result.stderrHex = Buffer.from(record.result.diagnostic).toString("hex"); }],
  ["wrong-input", record => { record.inputCodeUnits[0][0] = 120; }],
  ["wrong-command", record => { record.commandCodeUnits.push(0); }],
  ["wrong-wrapper-count", record => { record.wrapperInvocations = 7; }],
  ["wrong-export-identity", record => { record.identity.rootLeafFactory = false; }],
  ["wrong-context-identity", record => { if (!record.identity.forwarded.length) record.identity.forwarded.push({ handler: true, receiver: true, context: false, signal: true }); else record.identity.forwarded[0].context = false; }],
  ["wrong-signal-identity", record => { if (!record.identity.forwarded.length) record.identity.forwarded.push({ handler: true, receiver: true, context: true, signal: false }); else record.identity.forwarded[0].signal = false; }],
  ["wrong-root-path", record => { record.actualLoads.find(load => load.path.endsWith("/dist/index.js")).path = "/foreign/dist/index.js"; }],
  ["wrong-leaf-path", record => { record.actualLoads.find(load => load.path.endsWith("/dist/commands/expr/index.js")).path = "/foreign/dist/commands/expr/index.js"; }],
  ["wrong-module-hash", record => { record.actualLoads.find(load => load.path.endsWith("/dist/commands/expr/index.js")).sha256 = "0".repeat(64); }],
];
