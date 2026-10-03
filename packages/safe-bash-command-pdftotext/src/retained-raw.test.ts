import { FsError } from "safe-bash-contracts/errors";
import assert from "node:assert/strict";
import { test } from "node:test";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftotextCommand, runPdftotextCli } from "./index.js";

function pdf(encrypted = false) {
  const doc = PdfDocument.create();
  const first = doc.addPage(); first.drawText("café — first", { x: 20, y: 100, size: 12 });
  first.drawText("hyphen-", { x: 20, y: 80, size: 12 }); first.drawText("ation", { x: 20, y: 65, size: 12 });
  doc.addPage().drawText("second page", { x: 20, y: 100, size: 12 }); doc.addPage();
  return doc.save(encrypted ? { encrypt: { userPassword: "reader", ownerPassword: "owner" } } : {});
}
function encoded(text: string, encoding: string) {
  if (encoding === "Latin1") return Uint8Array.from(text, character => character.charCodeAt(0));
  if (encoding === "UCS-2") {
    const bytes = new Uint8Array(2 + text.length * 2), view = new DataView(bytes.buffer); view.setUint16(0, 0xfeff);
    for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i)); return bytes;
  }
  return new TextEncoder().encode(text);
}
async function fixture(input: Uint8Array, args: readonly string[], stdin = false) {
  const fs = createMemoryFileSystem(); await fs.writeFile("/input.pdf", input); await fs.writeFile("/output.txt", new TextEncoder().encode("old output"));
  let wholeReads = 0, payloadWrites = 0, published = 0; const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const guarded = new Proxy(Object.create(fs) as typeof fs, { get(_target, key) {
    if (key === "readFile") return async () => { wholeReads++; throw new Error("whole reads forbidden"); };
    if (key === "writeFile") return async () => { payloadWrites++; throw new Error("whole writes forbidden"); };
    if (key === "publishStagedFile") return async (...values: Parameters<NonNullable<typeof fs.publishStagedFile>>) => { published++; return fs.publishStagedFile!(...values); };
    const value = Reflect.get(fs, key); return typeof value === "function" ? value.bind(fs) : value;
  } });
  const carrier = createCommandArguments(args); const controller = new AbortController();
  const context = { command: "pdftotext", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    stdin: (async function* (): AsyncGenerator<Uint8Array, void, unknown> { if (!stdin) return; const buffer = new Uint8Array(37); for (let at = 0; at < input.length; at += buffer.length) { const size = Math.min(buffer.length, input.length - at); buffer.set(input.subarray(at, at + size)); yield buffer.subarray(0, size); } })(),
    signal: controller.signal, stdout: { async write(bytes: Uint8Array) { await Promise.resolve(); stdout.push(bytes.slice()); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes.slice()); } },
  };
  return { fs, context, controller, stdout, stderr, counts: () => ({ wholeReads, payloadWrites, published }), async clean() { assert.deepEqual(await fs.readdir("/scratch"), []); } };
}
const joined = (chunks: Uint8Array[]) => new Uint8Array(Buffer.concat(chunks));
for (const encoding of ["UTF-8", "Latin1", "ASCII7", "UCS-2", "Symbol", "ZapfDingbats"]) {
  test(`retained raw file input preserves ${encoding} bytes and atomic file output`, async () => {
    const input = pdf(); const args = ["-raw", "-enc", encoding, "-eol", "dos", "input.pdf", "output.txt"];
    const expected = await runPdftotextCli(args, new Map([["input.pdf", input]])); const f = await fixture(input, args);
    const result = await createPdftotextCommand().execute(f.context);
    assert.equal(result.exitCode, expected.exitCode); assert.deepEqual(await f.fs.readFile("/output.txt"), encoded(expected.output, encoding));
    assert.deepEqual(f.counts(), { wholeReads: 0, payloadWrites: 0, published: 1 }); await f.clean();
  });
}
test("retained raw stdin accepts reused chunks, page selection and a slow stdout sink", async () => {
  const input = pdf(true); const args = ["-raw", "-upw", "reader", "-f", "2", "-l", "2", "-nopgbrk", "-", "-"];
  const expected = await runPdftotextCli(args, new Map(), input); const f = await fixture(input, args, true);
  assert.equal((await createPdftotextCommand().execute(f.context)).exitCode, 0);
  assert.deepEqual(joined(f.stdout), new TextEncoder().encode(expected.output)); assert.deepEqual(f.counts(), { wholeReads: 0, payloadWrites: 0, published: 0 }); await f.clean();
});
test("retained raw input limit rejects before any output publication", async () => {
  const input = pdf(); const f = await fixture(input, ["-raw", "input.pdf", "output.txt"]);
  await assert.rejects(async () => createPdftotextCommand({ limits: { maxInputBytes: input.length - 1 } }).execute(f.context));
  assert.equal(new TextDecoder().decode(await f.fs.readFile("/output.txt")), "old output"); assert.equal(f.counts().published, 0); await f.clean();
});

for (const flags of [["-f", "9"], ["-l", "-1"], ["-eol", "invalid"], ["-q", "-eol", "invalid"], ["-eol", "mac", "-nopgbrk"]]) {
  test(`retained raw preserves range and EOL diagnostics: ${flags.join(" ")}`, async () => {
    const input = pdf(); const args = ["-raw", ...flags, "input.pdf", "-"]; const expected = await runPdftotextCli(args, new Map([["input.pdf", input]]));
    const f = await fixture(input, args); assert.equal((await createPdftotextCommand().execute(f.context)).exitCode, expected.exitCode);
    assert.equal(new TextDecoder().decode(joined(f.stderr)), expected.stderr); assert.equal(new TextDecoder().decode(joined(f.stdout)), expected.output); await f.clean();
  });
}
for (const quiet of [false, true]) {
  test(`retained raw preserves password errors and existing output (quiet=${quiet})`, async () => {
    const input = pdf(true); const args = ["-raw", ...(quiet ? ["-q"] : []), "-upw", "wrong", "input.pdf", "output.txt"];
    const expected = await runPdftotextCli(args, new Map([["input.pdf", input]])); const f = await fixture(input, args);
    assert.equal((await createPdftotextCommand().execute(f.context)).exitCode, expected.exitCode);
    assert.equal(new TextDecoder().decode(joined(f.stderr)), expected.stderr);
    assert.equal(new TextDecoder().decode(await f.fs.readFile("/output.txt")), "old output"); assert.equal(f.counts().published, 0); await f.clean();
  });
}
test("retained raw preserves the destination after a partially accepted staging write fails", async () => {
  const f = await fixture(pdf(), ["-raw", "input.pdf", "output.txt"]); const base = f.context.fs;
  f.context.fs = new Proxy(Object.create(base) as typeof base, { get(_target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof base.createStagedFile>>) => {
      const staged = await base.createStagedFile!(...args);
      if (args[1] !== "output") return staged;
      return { ...staged, writer: { finish: staged.writer!.finish.bind(staged.writer), async write(...writeArgs: Parameters<NonNullable<typeof staged.writer>["write"]>) {
        await staged.writer!.write(...writeArgs); throw new FsError("EIO", { path: args[0] });
      } } };
    };
    const value = Reflect.get(base, key); return typeof value === "function" ? value.bind(base) : value;
  } });
  assert.equal((await createPdftotextCommand().execute(f.context)).exitCode, 2);
  assert.equal(new TextDecoder().decode(await f.fs.readFile("/output.txt")), "old output"); assert.equal(f.counts().published, 0);
  assert.deepEqual((await f.fs.readdir("/")).map(entry => entry.name).sort(), ["input.pdf", "output.txt", "scratch"]); await f.clean();
});
test("retained raw propagates sink errors and removes all staged results", async () => {
  const f = await fixture(pdf(), ["-raw", "input.pdf", "-"]); const failure = { reason: "slow sink closed" };
  f.context.stdout.write = async () => { throw failure; };
  await assert.rejects(async () => createPdftotextCommand().execute(f.context), error => error === failure); await f.clean();
});
test("retained raw cancels stdin and cleans its partial staging", async () => {
  const input = pdf(); const f = await fixture(input, ["-raw", "-", "-"], true); const reason = { reason: "cancel input" }; let closed = false;
  f.context.stdin = (async function* () { try { yield input.subarray(0, 30); f.controller.abort(reason); yield input.subarray(30); } finally { closed = true; } })();
  await assert.rejects(async () => createPdftotextCommand().execute(f.context), error => error === reason);
  assert.equal(closed, true); assert.equal(f.stdout.length, 0); await f.clean();
});
test("retained raw supports publishing over its retained input after extraction", async () => {
  const input = pdf(); const args = ["-raw", "input.pdf", "input.pdf"]; const expected = await runPdftotextCli(args, new Map([["input.pdf", input]]));
  const f = await fixture(input, args); assert.equal((await createPdftotextCommand().execute(f.context)).exitCode, 0);
  assert.equal(new TextDecoder().decode(await f.fs.readFile("/input.pdf")), expected.output); await f.clean();
});
