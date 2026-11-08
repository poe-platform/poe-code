import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosDict, cosName, cosNumber, cosString } from "@poe-code/pdf-ast";
import { base64Parts, cosJson, jsonChunks, jsonRecord } from "./json-output.js";

it("formats wide duplicate dictionaries and escaped strings exactly", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const signal = new AbortController().signal, expected: Record<string, unknown> = {}, node = cosDict({});
  for (let index = 0; index < 513; index++) { const name = `key${index % 257}`, value = index === 512 ? 'a'.repeat(4095) + '😀\n\t\u0000"\\' : index; node.entries.push({ key: cosName(name), value: typeof value === "string" ? cosString(value) : cosNumber(value) }); expected[`/${name}`] = typeof value === "string" ? `u:${value}` : value; }
  let writes = 0;
  const guarded = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("Whole dictionary I/O"); };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof fs.createStagedFile>>) => { const staged = await fs.createStagedFile!(...args); if (!staged.writer) return staged; const writer = staged.writer; return { ...staged, writer: { ...writer, async write(bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) { writes++; assert.ok(bytes.buffer.byteLength <= 16384); return writer.write(bytes, options); } } }; };
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => { const handle = await fs.open!(...args); return new Proxy(handle, { get(target, key) { if (key === "write") return async (bytes: Uint8Array, ...args: unknown[]) => { writes++; assert.ok(bytes.buffer.byteLength <= 16384); return Reflect.apply(handle.write!, handle, [bytes, ...args]); }; const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; } }); };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const chunks = []; for await (const bytes of jsonChunks(cosJson(node, { fs: guarded, directory: "/scratch" }, signal), signal)) { assert.ok(bytes.buffer.byteLength <= 16384); chunks.push(bytes); }
  assert.equal(Buffer.concat(chunks).toString(), JSON.stringify(expected, null, 2) + "\n"); assert.ok(writes > 0); assert.deepEqual(await fs.readdir("/scratch"), []);
});

for (const length of [0, 1, 2, 3, 4095, 4096, 4097, 65537]) it(`encodes ${length} stream bytes across base64 boundaries`, async () => {
  const input = new Uint8Array(length); for (let i = 0; i < length; i++) input[i] = i % 251;
  async function* chunks() { for (let at = 0; at < length; at += 7) yield input.subarray(at, at + 7); }
  const signal = new AbortController().signal, output = [];
  for await (const bytes of jsonChunks(jsonRecord({ data: { kind: "text", parts: base64Parts(chunks(), signal) } }), signal)) output.push(bytes);
  assert.equal(Buffer.concat(output).toString(), JSON.stringify({ data: Buffer.from(input).toString("base64") }, null, 2) + "\n");
});

it("escapes lone surrogates at output buffer boundaries like JSON.stringify", async () => {
  const value = "a".repeat(4095) + "😀" + "b".repeat(4094) + "\ud800\udfff\ud800", chunks = [];
  for await (const chunk of jsonChunks(jsonRecord({ value }), new AbortController().signal)) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), JSON.stringify({ value }, null, 2) + "\n");
});
