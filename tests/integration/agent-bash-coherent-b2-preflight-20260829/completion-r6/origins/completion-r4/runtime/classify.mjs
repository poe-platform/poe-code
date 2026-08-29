import assert from "node:assert/strict";
import path from "node:path";

export function natural(result, code) { assert.equal(result.exitCode, code); assert.equal(result.exitSignal, null); assert.equal(result.exited, true); assert.equal(result.closed, true); assert.equal(result.signalCount, 0); }
export function diagnosticIdentities(text, filename, cwd = path.dirname(path.dirname(filename))) {
  assert.ok(!/uncaughtException|ERR_ACCESS_DENIED|SyntaxError:|MODULE_NOT_FOUND|FATAL ERROR/.test(text), "unrelated fatal diagnostic");
  const diagnostics = [];
  for (const line of text.split("\n")) {
    if (!/error TS\d+:/.test(line)) continue;
    const match = /^(.*)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line);
    assert.ok(match, "unexpected compiler diagnostic form"); assert.equal(path.resolve(cwd, match[1]), filename);
    diagnostics.push({ line: Number(match[2]), column: Number(match[3]), code: Number(match[4]), message: match[5] });
  }
  return diagnostics;
}
export function classifyTypes(result, text, filename, expected, negative, cwd) {
  natural(result, negative ? 2 : 0);
  const identities = diagnosticIdentities(text, filename, cwd);
  assert.deepEqual(identities, negative ? expected : []);
  return Object.freeze({ accepted: true, negative, diagnostics: identities });
}
export function failureIdentity(error) { assert.equal(typeof error, "string"); return error.split("\n").filter(line => !/^\s+at /.test(line)).join("\n"); }
export function classifyCases(result, output, expectedIds) {
  natural(result, 0); const cases = output.slice(0, -1); const summary = output.at(-1)?.summary;
  assert.deepEqual(cases.map(row => row.id), expectedIds); assert.equal(summary?.cases, expectedIds.length); assert.equal(summary?.pass, expectedIds.length);
  for (const row of cases) { assert.equal(row.pass, true); assert.ok(!row.cleanupError && !row.cleanupFailure); if (typeof row.created === "number") assert.equal(row.disposed, row.created); }
  return Object.freeze({ accepted: true, cases: cases.length });
}
export function classifyMutant(result, output, trace, mutation, expectedFailure) {
  natural(result, 1); assert.equal(output.length, 2); assert.equal(output[0].id, mutation.case); assert.equal(output[0].pass, false); assert.ok(!output[0].cleanupFailure && !output[0].cleanupError);
  assert.equal(output[1].summary.cases, 1); assert.equal(output[1].summary.fail, 1);
  assert.equal(failureIdentity(output[0].error), expectedFailure);
  assert.ok(trace.some(row => row.kind === "authenticated-source-supplied" && row.member === `dist/${mutation.file}` && row.sha256 === mutation.prospectiveMutantSha256), "mutant bytes must have been supplied by the authenticating loader");
  return Object.freeze({ accepted: true, loadedMutant: mutation.id, expectedAssertionKill: true });
}
export function classifyRestore(result, output, trace, mutation) {
  const cases = classifyCases(result, output, [mutation.case]);
  assert.ok(trace.some(row => row.kind === "authenticated-source-supplied" && row.member === `dist/${mutation.file}` && row.sha256 === mutation.restoreExpectedSha256), "restored original bytes must be loaded");
  return Object.freeze({ ...cases, loadedRestore: mutation.id });
}
export function classifyBinding(result, stdout, stderr, trace, alteration, packageRoot) {
  natural(result, 1); assert.equal(stdout.trim(), "");
  const member = alteration === "missing" ? "dist/index.js" : "dist/shell/parser.js";
  assert.ok(["missing", "changed"].includes(alteration));
  const identity = `B2_BINDING_REFUSAL:${alteration}:${path.join(packageRoot, member)}`;
  assert.ok(stderr.includes(`Error: ${identity}`));
  assert.ok(!/ERR_ACCESS_DENIED|SyntaxError|MODULE_NOT_FOUND/.test(stderr));
  const refusals = trace.filter(row => row.kind === "binding-refusal");
  assert.deepEqual(refusals, [{ kind: "binding-refusal", alteration, member, filename: path.join(packageRoot, member), identity }]);
  assert.ok(!trace.some(row => row.kind === "authenticated-source-supplied" && row.member === member));
  return Object.freeze({ accepted: true, expectedRefusal: identity });
}
