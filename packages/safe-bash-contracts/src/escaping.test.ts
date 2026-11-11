import assert from "node:assert/strict";
import test from "node:test";
import { escapeText, quoteShellOperand, writeDiagnostic } from "./escaping.js";

test("diagnostic escaping preserves UTF-8 budgets without Node Buffer", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
  Object.defineProperty(globalThis, "Buffer", { configurable: true, writable: true, value: undefined });
  try {
    const sizes: number[] = [];
    assert.equal(escapeText("é🙂\u009b\ud800\n", "diagnostic", bytes => { sizes.push(bytes); }), "é🙂\\302\\233\ud800\n");
    assert.deepEqual(sizes, [2, 6, 10, 14, 17, 18]);
    const chunks: Uint8Array[] = [];
    await writeDiagnostic({ async write(bytes) { chunks.push(bytes.slice()); } }, "🙂".repeat(4096) + "é\u001b\n");
    assert.deepEqual(chunks.map(bytes => bytes.byteLength), [16384, 7]);
    const decoder = new TextDecoder();
    assert.equal(chunks.map(bytes => decoder.decode(bytes)).join(""), "🙂".repeat(4096) + "é\\033\n");
  } finally {
    Object.defineProperty(globalThis, "Buffer", descriptor);
  }
});

test("shell operand quoting preserves its C-locale default and supports UTF-8", () => {
  for (const [value, c, utf8] of [
    ["é", "''$'\\303\\251'", "'é'"],
    ["café menu", "'caf'$'\\303\\251'' menu'", "'café menu'"],
    ["é\n", "''$'\\303\\251\\n'", "'é'$'\\n'"],
    ["é\u007f\u009b", "''$'\\303\\251\\177\\302\\233'", "'é'$'\\177\\302\\233'"],
    ["can't", `"can't"`, `"can't"`],
    ["é'$", "''$'\\303\\251'\\''$'", "'é'\\''$'"],
  ]) {
    assert.equal(quoteShellOperand(value!), c);
    assert.equal(quoteShellOperand(value!, true), utf8);
  }
});
