import { expect, it } from "vitest";
import { createDocxCommandEngine } from "./command.js";

it.each([
  ["image", "images"],
  ["table", "tables"],
  ["metadata", "properties"],
  ["replace", "text replace"]
])("rejects legacy %s with an actionable command path before I/O", async (legacy, replacement) => {
  let calls = 0;
  const engine = createDocxCommandEngine({ async execute() { calls++; return { exitCode: 0 }; } });
  const diagnostics: Uint8Array[] = [];
  const result = await engine.execute({
    args: [legacy, "private coastal text"].map(word => new TextEncoder().encode(word)),
    signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { calls++; yield new Uint8Array(); } },
    stdout: { async write() { calls++; } },
    stderr: { async write(bytes) { diagnostics.push(bytes); } }
  });
  const message = diagnostics.map(bytes => new TextDecoder().decode(bytes)).join("");
  expect(result.exitCode).toBe(2);
  expect(calls).toBe(0);
  expect(message).toContain(`docx ${replacement}`);
  expect(message).not.toContain("private coastal text");
});
