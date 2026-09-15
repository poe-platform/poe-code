import { expect, it } from "vitest";
import { commandDiagnostic, createDocxCommandEngine } from "./command.js";

it("explains how to recover from a stale selection within diagnostic bounds", () => {
  const diagnostic = commandDiagnostic("Document operation failed: stale-selection", "stale-selection", 1024);
  expect(diagnostic.message).toContain("Inspect the input again");
  expect(diagnostic.message).toContain("fresh location");
  expect(new TextEncoder().encode(diagnostic.human).length).toBeLessThanOrEqual(1024);
  expect(new TextEncoder().encode(commandDiagnostic("Document operation failed: stale-selection", "stale-selection", 48).human).length).toBeLessThanOrEqual(48);
});

it("identifies an invalid scope and its help route without echoing data or dispatching", async () => {
  let dispatched = false;
  const output: Uint8Array[] = [];
  const diagnostics: Uint8Array[] = [];
  const result = await createDocxCommandEngine({ async execute() { dispatched = true; return { exitCode: 0 }; } }).execute({
    args: ["text", "private.docx", "--scope", "private coastal text", "--json"].map(word => new TextEncoder().encode(word)),
    signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { dispatched = true; yield new Uint8Array(); } },
    stdout: { async write(bytes) { output.push(bytes); } },
    stderr: { async write(bytes) { diagnostics.push(bytes); } }
  });
  const text = output.map(bytes => new TextDecoder().decode(bytes)).join("");
  const envelope = JSON.parse(text);
  expect(result.exitCode).toBe(2);
  expect(dispatched).toBe(false);
  expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "usage" }] });
  expect(envelope.errors[0].message).toContain("--scope");
  expect(envelope.errors[0].message).toContain("docx help text get");
  expect(text).not.toContain("private coastal text");
  expect(diagnostics.map(bytes => new TextDecoder().decode(bytes)).join("")).toContain("docx help text get");
});
