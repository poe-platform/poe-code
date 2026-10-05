import { FsError } from "safe-bash-contracts/errors";
import assert from "node:assert/strict";
import { test } from "node:test";
import { PdfDocument, PdfRetainedDocument, cosDict, cosString, cosName, cosNumber, cosArray, dictSet } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftohtmlCommand, runPdftohtmlCli } from "./index.js";

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
  const context = { command: "pdftohtml", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded,
    stdin: (async function* (): AsyncGenerator<Uint8Array, void, unknown> { if (!stdin) return; const buffer = new Uint8Array(37); for (let at = 0; at < input.length; at += buffer.length) { const size = Math.min(buffer.length, input.length - at); buffer.set(input.subarray(at, at + size)); yield buffer.subarray(0, size); } })(),
    signal: controller.signal, stdout: { async write(bytes: Uint8Array) { await Promise.resolve(); stdout.push(bytes.slice()); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes.slice()); } },
  };
  return { fs, context, controller, stdout, stderr, counts: () => ({ wholeReads, payloadWrites, published }), async clean() { assert.deepEqual(await fs.readdir("/scratch"), []); } };
}
const joined = (chunks: Uint8Array[]) => new Uint8Array(Buffer.concat(chunks));

for (const mode of [[], ["-xml"]]) for (const image of [[], ["-i"], ["-dataurls"], ["-fmt", "jpg"]]) {
  test(`retained HTML preserves bytes without whole input reads: ${[...mode, ...image]}`, async () => {
    const doc = PdfDocument.create(), page = doc.addPage([200, 200]);
    page.drawText("Hello & café", { x: 10, y: 100, size: 12, font: "Helvetica-BoldOblique" });
    page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([255, 0, 0])), { x: 0, y: 0, width: 8, height: 8 });
    const input = doc.save(), args = [...mode, ...image, "input.pdf", "-"];
    const expected = await runPdftohtmlCli(args, new Map([["input.pdf", input]])), f = await fixture(input, args);
    assert.equal((await createPdftohtmlCommand().execute(f.context)).exitCode, expected.exitCode);
    assert.deepEqual(joined(f.stdout), new TextEncoder().encode(expected.stdout));
    assert.deepEqual(joined(f.stderr), new TextEncoder().encode(expected.stderr));
    assert.deepEqual(f.counts(), { wholeReads: 0, payloadWrites: 0, published: 0 }); await f.clean();
  });
}

for (const mode of [[], ["-xml"]]) test(`retained HTML preserves nested outlines and skips untitled branches: ${mode}`, async (t) => {
  const doc = PdfDocument.create(); doc.addPage().drawText("Outline", { x: 10, y: 100 });
  const item = (title: string, extra = {}) => cosDict({ Title: cosString(title), Dest: cosArray([cosNumber(0), cosName("Fit")]), ...extra });
  const following = item("Following");
  const hidden = item("", { First: item("Hidden child"), Next: following });
  const parent = item("Parent & 😀 title".repeat(2048), { First: item("Child", { First: item("Grandchild") }), Next: hidden });
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "Outlines", cosDict({ First: parent }));
  const input = doc.save(), args = [...mode, "input.pdf", "-"];
  const expected = await runPdftohtmlCli(args, new Map([["input.pdf", input]])), f = await fixture(input, args);
  t.mock.method(PdfRetainedDocument.prototype, "outlineDetails", () => { throw new Error("whole outline title forbidden"); });
  assert.equal((await createPdftohtmlCommand().execute(f.context)).exitCode, expected.exitCode);
  assert.equal(new TextDecoder().decode(joined(f.stdout)), expected.stdout); await f.clean();
});

for (const encoding of ["UTF-8", "ASCII7", "Latin1", "UCS-2", "Symbol", "ZapfDingbats"]) test(`retained HTML publishes encoded files and image siblings (${encoding})`, async () => {
  const doc = PdfDocument.create(), page = doc.addPage([200, 200]); doc.setMetadata({ title: "café & résumé" });
  page.drawText("café & ligature ﬁ", { x: 10, y: 100 });
  page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([255, 0, 0])), { x: 0, y: 0, width: 8, height: 8 });
  const input = doc.save(), args = ["-enc", encoding, "input.pdf", "sub/report.html"], files = new Map([["input.pdf", input]]);
  const expected = await runPdftohtmlCli(args, files), f = await fixture(input, args); await f.fs.mkdir("/sub");
  assert.equal((await createPdftohtmlCommand().execute(f.context)).exitCode, expected.exitCode);
  for (const [name, bytes] of files) if (name !== "input.pdf") assert.deepEqual(await f.fs.readFile("/" + name), bytes);
  assert.deepEqual(f.counts(), { wholeReads: 0, payloadWrites: 0, published: 2 }); await f.clean();
});
test("retained HTML keeps input identity when an extracted image replaces the input name", async () => {
  const doc = PdfDocument.create(), page = doc.addPage([200, 200]);
  page.drawText("Retained input", { x: 10, y: 100 }); page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([255, 0, 0])), { x: 0, y: 0, width: 8, height: 8 });
  const input = doc.save(), args = ["page1_1.png", "output.html"], files = new Map([["page1_1.png", input]]);
  const expected = await runPdftohtmlCli(args, files), f = await fixture(input, args); await f.fs.writeFile("/page1_1.png", input);
  assert.equal((await createPdftohtmlCommand().execute(f.context)).exitCode, expected.exitCode);
  for (const [name, bytes] of files) assert.deepEqual(await f.fs.readFile("/" + name), bytes); await f.clean();
});
test("retained HTML reads reused stdin chunks with passwords and selected pages", async () => {
  const doc = PdfDocument.create(); doc.addPage().drawText("first", { x: 10, y: 100 }); doc.addPage().drawText("second", { x: 10, y: 100 });
  const input = doc.save({ encrypt: { userPassword: "reader", ownerPassword: "owner" } }), args = ["-upw", "reader", "-f", "2", "-l", "2", "-zoom", "1.5", "-", "-"];
  const expected = await runPdftohtmlCli(args, new Map([["-", input]])), f = await fixture(input, args, true);
  assert.equal((await createPdftohtmlCommand().execute(f.context)).exitCode, expected.exitCode);
  assert.equal(new TextDecoder().decode(joined(f.stdout)), expected.stdout); await f.clean();
});

for (const args of [["-f", "9", "input.pdf", "-"], ["-fmt", "bad", "input.pdf"], ["-enc", "bad", "input.pdf"], ["missing.pdf", "-"]]) test(`retained HTML preserves diagnostics: ${args}`, async () => {
  const doc = PdfDocument.create(); doc.addPage(); const input = doc.save(), files = new Map([["input.pdf", input]]);
  const expected = await runPdftohtmlCli(args, files), f = await fixture(input, args);
  assert.equal((await createPdftohtmlCommand().execute(f.context)).exitCode, expected.exitCode);
  assert.equal(new TextDecoder().decode(joined(f.stderr)), expected.stderr);
  assert.equal(new TextDecoder().decode(joined(f.stdout)), expected.stdout);
});
for (const input of [new Uint8Array(), new TextEncoder().encode("not a PDF")]) test(`retained HTML preserves malformed input diagnostics (${input.length})`, async () => {
  const args = ["input.pdf", "-"], expected = await runPdftohtmlCli(args, new Map([["input.pdf", input]])), f = await fixture(input, args);
  assert.equal((await createPdftohtmlCommand().execute(f.context)).exitCode, expected.exitCode);
  assert.equal(new TextDecoder().decode(joined(f.stderr)), expected.stderr); await f.clean();
});
test("retained HTML cancellation at a slow sink releases staged outputs", async () => {
  const doc = PdfDocument.create(); doc.addPage().drawText("cancel output", { x: 10, y: 100 });
  const f = await fixture(doc.save(), ["input.pdf", "-"]), reason = new Error("cancel HTML sink"); let writes = 0;
  f.context.stdout.write = async () => { writes++; f.controller.abort(reason); await Promise.resolve(); };
  await assert.rejects(async () => createPdftohtmlCommand().execute(f.context), error => error === reason);
  assert.equal(writes, 1); await f.clean();
});
test("retained HTML failed publication keeps the destination and removes staging", async () => {
  const doc = PdfDocument.create(); doc.addPage().drawText("publish", { x: 10, y: 100 });
  const f = await fixture(doc.save(), ["input.pdf", "out.html"]); await f.fs.writeFile("/out.html", new TextEncoder().encode("existing"));
  f.context.fs = new Proxy(f.context.fs, { get(target, key) { if (key === "publishStagedFile") return async () => { throw new FsError("EIO"); }; return Reflect.get(target, key); } });
  assert.equal((await createPdftohtmlCommand().execute(f.context)).exitCode, 0);
  assert.equal(new TextDecoder().decode(joined(f.stderr)), "I/O Error: Couldn't open html file 'out.html'\n");
  assert.equal(new TextDecoder().decode(await f.fs.readFile("/out.html")), "existing"); await f.clean();
});
test("retained HTML enforces configured input limits before payload reads", async () => {
  const doc = PdfDocument.create(); doc.addPage(); const input = doc.save(), f = await fixture(input, ["input.pdf", "-"]);
  await assert.rejects(async () => createPdftohtmlCommand({ limits: { maxInputBytes: input.length - 1 } }).execute(f.context), { code: "EFBIG" });
  assert.equal(f.stdout.length, 0); await f.clean();
});
test("retained HTML publishes a replaced input before later image map entries", async () => {
  const doc = PdfDocument.create(), page = doc.addPage([200, 200]);
  page.drawText("replace input", { x: 10, y: 100 }); page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([255, 0, 0])), { x: 0, y: 0, width: 8, height: 8 });
  const input = doc.save(), f = await fixture(input, ["report.html", "report.html"]); await f.fs.writeFile("/report.html", input);
  const published: string[] = [], original = f.context.fs;
  f.context.fs = new Proxy(original, { get(target, key) {
    if (key === "publishStagedFile") return async (...args: Parameters<NonNullable<typeof original.publishStagedFile>>) => { published.push(args[1]); return original.publishStagedFile!(...args); };
    return Reflect.get(target, key);
  } });
  assert.equal((await createPdftohtmlCommand().execute(f.context)).exitCode, 0);
  assert.deepEqual(published, ["/report.html", "/page1_1.png"]); await f.clean();
});

for (const title of ["", "café & <title>".repeat(1024)]) test(`retained HTML streams the selected metadata title (${title.length})`, async t => {
  const doc = PdfDocument.create(); doc.addPage(); doc.setMetadata({ title });
  dictSet(doc.cos.resolveDict(doc.cos.infoRef)!, "Unrelated", cosString("ignored".repeat(8192)));
  const input = doc.save(), args = ["input.pdf", "-"], expected = await runPdftohtmlCli(args, new Map([["input.pdf", input]])), f = await fixture(input, args);
  t.mock.method(PdfRetainedDocument.prototype, "info", async () => { throw new Error("whole metadata map forbidden"); });
  assert.equal((await createPdftohtmlCommand().execute(f.context)).exitCode, expected.exitCode);
  assert.equal(new TextDecoder().decode(joined(f.stdout)), expected.stdout); await f.clean();
});

test("retained HTML reports empty implicit stdin as an input error", async () => {
  const f = await fixture(new Uint8Array(), []);
  assert.equal((await createPdftohtmlCommand().execute(f.context)).exitCode, 1);
  assert.equal(new TextDecoder().decode(joined(f.stderr)), "I/O Error: Couldn't open file '-'\n");
  await f.clean();
});
