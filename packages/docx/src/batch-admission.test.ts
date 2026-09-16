import { expect, it } from "vitest";
import { createDocxCommandEngine, parseDocxArguments, validateDocxBatch, validateDocxInvocation } from "./command.js";
import { docxValueSchema } from "./operation-json-schema.js";
const operation = { operation: "text.replace", arguments: { find: "Harbor", with: "Port", all: true } };
const binary = { operation: "model.image.image.Image.from_file.call", arguments: { imageDescriptor: { kind: "stdin" } } };
it("preserves stable item IDs and rejects duplicate or malformed IDs", () => {
  expect(validateDocxBatch({ version: 1, operations: [{ ...operation, id: "replace-title" }] }).operations[0]).toMatchObject({ id: "replace-title" });
  for (const id of [null, "", "1", "a b", "a\0", "a".repeat(65), () => "unsafe"])
    expect(() => validateDocxBatch({ version: 1, operations: [{ ...operation, id }] })).toThrow();
  expect(() => validateDocxBatch({ version: 1, operations: [{ ...operation, id: "title" }, { ...operation, id: "title" }] })).toThrow("duplicate");
  expect(() => validateDocxBatch({ version: 1, operations: [operation, { ...operation, id: "step1" }] })).toThrow("duplicate");
});
it("rejects item publication and resource controls through the closed schema", () => {
  const model = { operation: "model.shared.Inches.call", arguments: { inches: 1 } };
  for (const key of ["limit", "json", "dryRun", "output", "inPlace", "force"])
    expect(() => validateDocxBatch({ version: 1, operations: [{ ...model, arguments: { ...model.arguments, [key]: key === "limit" ? { batchOperations: 1 } : true } }] })).toThrow();
});
it("rejects dual explicit stdin sources and undeclared binary stdin syntax", () => {
  expect(() => validateDocxBatch({ version: 1, operations: [binary] })).toThrow();
  expect(() => parseDocxArguments(["batch", "-", "--ops-file", "-", "--dry-run"].map(value => new TextEncoder().encode(value)))).toThrow("stdin consumer");
});
it("describes optional stable IDs in the shared closed batch schema", () => {
  const schema = docxValueSchema("OperationV1");
  expect(schema.oneOf?.every(item => item.properties?.id?.maxLength === 64)).toBe(true);
});
it("normalizes outer author and timestamp only into tracked replacement items", () => {
  const defaults = { author: "Surveyor", timestamp: "2026-04-05T06:07:08Z" };
  const tracked = { ...operation, arguments: { ...operation.arguments, trackChanges: true } };
  const invocation = validateDocxInvocation({ operation: "batch", inputs: ["/document"], options: { ...defaults, version: 1, operations: [tracked], dryRun: true } });
  expect(invocation.options.operations).toMatchObject([{ arguments: defaults }]);
  const args = ["batch", "/document", "--ops-json", JSON.stringify({ version: 1, operations: [tracked] }), "--author", defaults.author, "--timestamp", defaults.timestamp, "--dry-run"];
  expect(parseDocxArguments(args.map(value => new TextEncoder().encode(value))).options.operations).toMatchObject([{ arguments: defaults }]);
  const untracked = validateDocxInvocation({ operation: "batch", inputs: ["/document"], options: { ...defaults, version: 1, operations: [operation], dryRun: true } });
  expect(untracked.options.operations).toEqual([operation]);
});
it("rejects malformed outer metadata and conflicts while preserving explicit item metadata", () => {
  const defaults = { author: "Surveyor", timestamp: "2026-04-05T06:07:08Z" };
  const tracked = { ...operation, arguments: { ...operation.arguments, trackChanges: true, ...defaults } };
  expect(validateDocxBatch({ version: 1, operations: [tracked] }).operations).toEqual([tracked]);
  expect(validateDocxBatch({ version: 1, operations: [tracked] }, undefined, defaults).operations).toEqual([tracked]);
  for (const context of [{ author: () => "unsafe" }, { timestamp: "yesterday" }, { eval: "unsafe" }, { author: "Navigator", timestamp: defaults.timestamp }])
    expect(() => validateDocxBatch({ version: 1, operations: [tracked] }, undefined, context)).toThrow();
});

it("rejects binary stdin declared inside an operations envelope read from stdin", async () => {
  let executions = 0;
  const engine = createDocxCommandEngine({ async execute() { executions++; return { exitCode: 0 }; } });
  const result = await engine.execute({ args: ["batch", "/document", "--ops-file", "-"].map(value => new TextEncoder().encode(value)), signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(JSON.stringify({ version: 1, operations: [binary] })); } }, stdout: { async write() {} }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(2);
  expect(executions).toBe(0);
});
