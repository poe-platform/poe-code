import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export const n04Message = "Object literal may only specify known properties, but 'maxRegexSteps' does not exist in type 'Partial<ExprLimits>'. Did you mean to write 'maxRegexStates'?";
const tuples = [
  [5, 25, "TS2353", "Object literal may only specify known properties, and 'regex' does not exist in type 'Omit<ExprCommandsOptions, \"replace\" | \"regex\">'."],
  [7, 31, "TS2353", "Object literal may only specify known properties, and 'replace' does not exist in type 'Omit<ExprCommandsOptions, \"replace\" | \"regex\">'."],
  [9, 31, "TS2322", "Type 'string' is not assignable to type 'number'."],
  [11, 32, "TS2561", n04Message],
  [13, 25, "TS2322", "Type 'string' is not assignable to type 'number'."],
  [15, 40, "TS2322", "Type 'string' is not assignable to type 'boolean | undefined'."],
];
export function expectedOutput(filename, id) {
  assert.ok(["N04", "combined"].includes(id));
  return (id === "N04" ? [tuples[3]] : tuples).map(([line, column, code, message]) => `${filename}(${line},${column}): error ${code}: ${message}\n`).join("");
}
export function validateType(receipt, spec, binding) {
  assert.equal(receipt.closed, true, "closed child required");
  assert.equal(receipt.naturalSettlement, true, "forced settlement never qualifies");
  assert.equal(receipt.supervision, null);
  assert.equal(receipt.artifactCompleteness, "full-observed-child-streams");
  assert.equal(receipt.previewTruncated, false);
  assert.equal(receipt.status, 2);
  assert.equal(receipt.class, "ordinary");
  assert.deepEqual(receipt.args, spec.args);
  assert.equal(receipt.cwd, spec.cwd);
  assert.equal(receipt.executable, spec.executable);
  assert.equal(receipt.executableSha256, spec.executableSha256);
  assert.equal(receipt.stderr, "");
  assert.equal(receipt.stdout, expectedOutput(spec.filename, spec.id), "exact case-specific diagnostic bytes required");
  assert.equal(receipt.bindings.find(row => row.path === `${spec.cwd}/${spec.filename}`)?.sha256, spec.inputSha256);
  assert.equal(binding.status, "qualified");
  assert.equal(binding.consumer, spec.cwd);
  assert.equal(binding.runtimeSha256, spec.executableSha256);
  assert.deepEqual(binding.declarations, spec.declarations);
  assert.deepEqual(binding.tools, spec.tools);
  assert.ok(binding.traceSha256 && /^[a-f0-9]{64}$/u.test(binding.traceSha256));
  assert.equal(binding.forbiddenResolution, false);
  assert.equal(binding.naturalSettlement, true);
  return { status: "pass", id: spec.id, diagnostics: spec.id === "N04" ? 1 : 6 };
}
export const mutations = [
  ["wrong-code", value => { value.receipt.stdout = value.receipt.stdout.replace("TS2561", "TS2353"); }],
  ["wrong-field", value => { value.receipt.stdout = value.receipt.stdout.replace("maxRegexSteps", "maxRegexStepz"); }],
  ["wrong-line", value => { value.receipt.stdout = value.receipt.stdout.replace("(11,32)", "(12,32)"); }],
  ["wrong-column", value => { value.receipt.stdout = value.receipt.stdout.replace("(11,32)", "(11,31)"); }],
  ["wrong-consumer", value => { value.receipt.stdout = value.receipt.stdout.replace(value.spec.filename, "other.ts"); }],
  ["wrong-type", value => { value.receipt.stdout = value.receipt.stdout.replace("Partial<ExprLimits>", "OtherLimits"); }],
  ["wrong-suggestion", value => { value.receipt.stdout = value.receipt.stdout.replace("maxRegexStates", "maxRegexNodes"); }],
  ["duplicate-diagnostic", value => { value.receipt.stdout += value.receipt.stdout.split("\n").find(line => line.includes("(11,32)")) + "\n"; }],
  ["missing-tool", value => { value.receipt.stdout = "error TS2307: Cannot find module 'virtual-bash'.\n"; }],
  ["missing-library", value => { value.receipt.stderr = "error TS2688: Cannot find type definition file for 'node'.\n"; }],
  ["wrong-root-resolution", value => { value.binding.declarations[0].path = "/foreign/dist/index.d.ts"; }],
  ["wrong-leaf-resolution", value => { value.binding.declarations[1].path = "/foreign/dist/commands/expr/index.d.ts"; }],
  ["wrong-declaration-hash", value => { value.binding.declarations[1].sha256 = "0".repeat(64); }],
  ["wrong-input-hash", value => { value.receipt.bindings.find(row => row.path.endsWith(`/${value.spec.filename}`)).sha256 = "0".repeat(64); }],
  ["wrong-compiler-hash", value => { value.binding.tools[0].sha256 = "0".repeat(64); }],
  ["wrong-exit", value => { value.receipt.status = 1; }],
  ["forced-settlement", value => { value.receipt.naturalSettlement = false; value.receipt.supervision = "child-deadline"; }],
  ["incomplete-raw", value => { value.receipt.artifactCompleteness = "captured-prefix-truncated"; }],
  ["source-fallback", value => { value.binding.forbiddenResolution = true; }],
  ["removed-permission", value => { value.receipt.args = value.receipt.args.filter(argument => argument !== "--permission"); }],
];
export function qualifyValidator(positive, capture) {
  const controls = [];
  function check(id, source, shouldReject) {
    let result, error;
    try { result = validateType(source.receipt, source.spec, source.binding); }
    catch (caught) { error = { name: caught.name, message: caught.message }; }
    capture(id, { id, source, shouldReject, result, error, rejected: error !== undefined });
    assert.equal(error !== undefined, shouldReject, id);
  }
  for (const source of positive) {
    check(`${source.spec.id}-authenticated-positive`, source, false);
    controls.push({ id: `${source.spec.id}-authenticated-positive`, status: "pass", kind: "authenticated-prior-receipt-validator-control" });
    for (const [name, mutate] of mutations) {
      const value = structuredClone(source); mutate(value);
      check(`${source.spec.id}-${name}`, value, true);
      controls.push({ id: `${source.spec.id}-${name}`, status: "pass", kind: "harness-negative-receipt-mutation-not-product-type" });
    }
  }
  return controls;
}
