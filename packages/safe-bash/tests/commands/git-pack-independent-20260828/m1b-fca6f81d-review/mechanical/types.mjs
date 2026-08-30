import { Buffer } from "node:buffer";

const diagnostics = new Map([
  ["T02", { line: 2, column: 20, code: 2353, message: "Object literal may only specify known properties, and 'limits' does not exist in type 'GitCommandsOptions'." }],
  ["T03", { line: 2, column: 15, code: 2353, message: "Object literal may only specify known properties, and 'spawn' does not exist in type 'GitCommandsOptions'." }],
  ["T04", { line: 2, column: 21, code: 2322, message: "Type 'number' is not assignable to type 'string'." }],
  ["T05", { line: 2, column: 15, code: 2322, message: "Type 'string' is not assignable to type 'boolean | undefined'." }],
]);

export async function runCase(api, caseId) {
  if (caseId !== "T01" && !diagnostics.has(caseId)) throw new Error("Unknown type fixture");
  const result = await api.compile(caseId);
  await api.captureBytes("type-stdout", result.stdout);
  await api.captureBytes("type-stderr", result.stderr);
  const stdout = Buffer.from(result.stdout).toString("utf8");
  const stderr = Buffer.from(result.stderr).toString("utf8");
  const expected = diagnostics.get(caseId);
  const filename = `${api.caseRoot}/${caseId}.mts`;
  const expectedLine = expected ? `${filename}(${expected.line},${expected.column}): error TS${expected.code}: ${expected.message}\n` : "";
  await api.capture("type-outcome", {
    caseId, code: result.code, signal: result.signal, stdout, stderr, expectedLine,
    compilerCounterproofMatched: result.code === (expected ? 2 : 0) && result.signal === null && stderr === "" && stdout === expectedLine,
    aggregateRule: "ANY_NONZERO_CHILD_IS_AGGREGATE_FAIL; matched diagnostic is not a process pass or waiver",
    publicExportState: "PUBLIC_EXPORT_GAP",
  });
  api.check("type-diagnostic-counterproof", result.code === (expected ? 2 : 0) && result.signal === null && stderr === "" && stdout === expectedLine);
  api.check("compiler-zero-exit-required-by-root", result.code === 0 && result.signal === null);
}
