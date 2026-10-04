import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { BackedJson, parseBackedJson } from "@poe-code/json-ast";
import { cosArray, cosDict, cosName, cosNumber, cosRef, cosString, cosHexString } from "../ast.js";
import { serializeCosNodeBytes } from "./writer.js";
import { QpdfJsonValues } from "./qpdf-json-values.js";

async function fixture(input: string | AsyncIterable<string>, run: (values: QpdfJsonValues, root: number) => Promise<void>, signal = new AbortController().signal) {
  const fs = createMemoryFileSystem(); const context = { fs, cwd: "/", env: {}, signal };
  const tape = new PagedStorage(context, 1), scratch = new PagedStorage(context, 1);
  const tree = new BackedJson(tape, async () => {}); let values: QpdfJsonValues | undefined;
  try {
    await parseBackedJson(typeof input === "string" ? (async function* () { for (let at = 0; at < input.length; at += 7) yield input.slice(at, at + 7); })() : input, tree, scratch, async () => {}, (_at, message) => { throw new Error(message); }, undefined, true);
    values = await QpdfJsonValues.open(tree, { fs, directory: "/" }, { signal });
    await run(values, tree.rootPosition);
  } finally { await values?.close(); await tape.close(); await scratch.close(); }
  expect(await fs.readdir("/")).toEqual([]);
}
async function collect(chunks: AsyncIterable<Uint8Array>) { const parts = []; for await (const bytes of chunks) { expect(bytes.buffer.byteLength).toBeLessThanOrEqual(16384); parts.push(bytes); } return new Uint8Array(Buffer.concat(parts)); }

it("matches ordinary COS string, name, numeric, reference and container serialization", async () => {
  const value = [null, true, false, 1.23456789, 9007199254740992, "/Name", "n:/Name", "n:Name", "u:1 0 R", "b:0123ff", "é€—", "日本😀\ud800", "a\n(b)\\", "12 3 R", "obj:12 3 obj", [1, "text"]];
  const expected = cosArray([{kind:"null"}, {kind:"boolean",value:true}, {kind:"boolean",value:false}, cosNumber(1.23456789), cosNumber(9007199254740992), cosName("Name"), cosName("Name"), cosName("Name"), cosString("1 0 R"), cosHexString(Uint8Array.of(1,35,255)), cosString("é€—"), cosString("日本😀\ud800"), cosString("a\n(b)\\"), cosRef(12,3), cosRef(12,3), cosArray([cosNumber(1),cosString("text")])]);
  await fixture(JSON.stringify(value), async (values, root) => { expect(await collect(values.chunks(root))).toEqual(serializeCosNodeBytes(expected)); });
});

it("preserves JSON enumeration before decoded PDF dictionary collisions", async () => {
  const input = '{"z":0,"2":2,"1":1,"/2":3,"n:/a":4,"/a":5,"a":6,"z":{"a":1,"a":2},"/1":7,"/":8,"":9}';
  const expected = cosDict({ "1": cosNumber(7), "2": cosNumber(3), z: cosDict({a:cosNumber(2)}), a:cosNumber(6), "":cosNumber(9) });
  await fixture(input, async (values, root) => { expect(await collect(values.chunks(root))).toEqual(serializeCosNodeBytes(expected)); });
});

it("converts giant fragmented strings and keys without collecting scalar text", async () => {
  const key = "key".repeat(6000), text = "a()\\é".repeat(10000) + "😀";
  await fixture(JSON.stringify({[key]: text}), async (values, root) => {
    expect(await collect(values.chunks(root))).toEqual(serializeCosNodeBytes(cosDict({[key]:cosString(text)})));
  });
});

it("keeps long zero-padded references and legacy whitespace rules", async () => {
  for (const [text, expected] of [["obj:" + "0".repeat(20000) + "12 0003 R", cosRef(12,3)], ["\n 12 3 obj\t", cosRef(12,3)], ["12\t3 R", cosString("12\t3 R")], ["2147483648 0 R", cosString("2147483648 0 R")], ["1 65536 R",cosString("1 65536 R")], ["0 0 R",cosString("0 0 R")], ["  obj:1 0 R",cosString("  obj:1 0 R")]] as const) {
    await fixture(JSON.stringify(text), async (values, root) => { expect(await collect(values.chunks(root))).toEqual(serializeCosNodeBytes(expected)); });
  }
});

it("retains permissive hexadecimal pair decoding and ignores an unmatched final digit", async () => {
  for (const text of [" 01ffF ", "1zgg-1+f", "0x12", "\t1 2f\n", "f", ""]) {
    const clean = text.trim(), bytes = new Uint8Array(Math.floor(clean.length / 2));
    for (let i = 0; i < bytes.length; i++) { const n = Number.parseInt(clean.slice(i * 2,i * 2 + 2),16); bytes[i] = Number.isNaN(n) ? 0 : n; }
    await fixture(JSON.stringify("b:"+text), async (values, root) => { expect(await collect(values.chunks(root))).toEqual(serializeCosNodeBytes(cosHexString(bytes))); });
  }
});


it("serializes generated wide and deeply nested arrays without a resident traversal stack", async () => {
  const count = 5000, depth = 1500;
  const input = (async function* () { for (let i = 0; i < depth; i++) yield "["; for (let i = 0; i < count; i++) yield i ? ",1" : "1"; for (let i = 0; i < depth; i++) yield "]"; })();
  await fixture(input, async (values, root) => {
    let bytes = 0, opens = 0, closes = 0, numbers = 0;
    for await (const chunk of values.chunks(root)) {
      expect(chunk.buffer.byteLength).toBeLessThanOrEqual(16384);
      for (const byte of chunk) { if (byte === 91) opens++; if (byte === 93) closes++; if (byte === 49) numbers++; }
      bytes += chunk.length; await Promise.resolve();
    }
    expect(opens).toBe(depth); expect(closes).toBe(depth); expect(numbers).toBe(count); expect(bytes).toBe(count * 2 + depth * 4 - 1);
  });
});

it("rejects nonfinite numeric values with ordinary PDF diagnostics", async () => {
  await fixture("1e400", async (values, root) => { await expect(collect(values.chunks(root))).rejects.toThrow("Invalid non-finite PDF number: Infinity"); });
});

it("honors timer cancellation and caller closure during replay", async () => {
  const controller = new AbortController(), reason = new Error("stop conversion");
  await fixture(JSON.stringify("text".repeat(20000)), async (values, root) => {
    const timer = setTimeout(() => controller.abort(reason), 0);
    try { await expect(collect(values.chunks(root))).rejects.toBe(reason); } finally { clearTimeout(timer); }
  }, controller.signal);
  await fixture('"text"', async (values, root) => { await values.close(); await expect(collect(values.chunks(root))).rejects.toThrow("closed"); });
});

it("preserves insertion order of decoded numeric names and collisions across chunk boundaries", async () => {
  const key = "x".repeat(4095) + "\ud800tail";
  const input = JSON.stringify({"/2":2,"/1":1,["n:/"+key]:0,["/"+key]:3});
  const expected = {kind:"dict" as const, entries:[{key:cosName("2"),value:cosNumber(2)},{key:cosName("1"),value:cosNumber(1)},{key:cosName(key),value:cosNumber(3)}]};
  await fixture(input, async (values, root) => { expect(await collect(values.chunks(root))).toEqual(serializeCosNodeBytes(expected)); });
});

it("preserves empty containers and does not recognize malformed references", async () => {
  await fixture('[{},[],"", "n:", "u:", "b:"]', async (values, root) => {
    expect(await collect(values.chunks(root))).toEqual(serializeCosNodeBytes(cosArray([cosDict({}),cosArray([]),cosString(""),cosName(""),cosString(""),cosHexString(new Uint8Array())])));
  });
  for (const text of ["1 0", "1 0 R x", "1 0 \tR", "1 0 o", "1 0 objx", "1 0 R\nR", "+1 0 R", "1 -0 R", "1 0.0 R", "1 0 R/", "obj:"]) {
    await fixture(JSON.stringify(text), async (values, root) => { expect(await values.reference(root)).toBeUndefined(); expect(await collect(values.chunks(root))).toEqual(serializeCosNodeBytes(cosString(text))); });
  }
});
