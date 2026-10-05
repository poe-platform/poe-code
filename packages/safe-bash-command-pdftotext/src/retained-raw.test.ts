import { FsError } from "safe-bash-contracts/errors";
import assert from "node:assert/strict";
import { test } from "node:test";
import { PdfDocument, cosDict, cosName, cosString, cosArray, cosNumber, dictSet, dictGet } from "@poe-code/pdf-ast";
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
for (const encoding of ["UTF-8", "Latin1", "ASCII7", "UCS-2", "Symbol", "ZapfDingbats"]) {
  test(`retained raw HTML metadata preserves ${encoding}, escaping and body-only EOL conversion`, async () => {
    const doc = PdfDocument.create();
    doc.setMetadata({ title: "café <title> & 'quote'", author: 'A "writer"', subject: "topic", creator: "tool", producer: "engine" });
    doc.addPage().drawText("café <text> & 'quote'", { x: 20, y: 100, size: 12 }); doc.addPage();
    const input = doc.save(), args = ["-raw", "-htmlmeta", "-enc", encoding, "-eol", "dos", "input.pdf", "output.txt"];
    const expected = await runPdftotextCli(args, new Map([["input.pdf", input]])); const f = await fixture(input, args);
    assert.equal((await createPdftotextCommand().execute(f.context)).exitCode, expected.exitCode);
    assert.deepEqual(await f.fs.readFile("/output.txt"), encoded(expected.output, encoding));
    assert.deepEqual(f.counts(), { wholeReads: 0, payloadWrites: 0, published: 1 }); await f.clean();
  });
}
test("retained HTML streams large escaped metadata across a surrogate boundary without whole reads", async () => {
  const doc = PdfDocument.create(); doc.setMetadata({ title: "&".repeat(4095) + "😀" + "<".repeat(8192) });
  doc.addPage().drawText("kept", { x: 20, y: 100, size: 12 });
  const input = doc.save(), args = ["-raw", "-htmlmeta", "input.pdf", "-"];
  const expected = await runPdftotextCli(args, new Map([["input.pdf", input]])); const f = await fixture(input, args);
  assert.equal((await createPdftotextCommand().execute(f.context)).exitCode, 0);
  assert.equal(new TextDecoder().decode(joined(f.stdout)), expected.output); assert.equal(f.counts().wholeReads, 0); await f.clean();
});
for (const failure of [{ reason: "backend unavailable" }, new Error("backend password service unavailable"), new FsError("EIO", { path: "/input.pdf" })]) {
  test(`retained raw preserves backend read failures and cleanup: ${String(failure)}`, async () => {
    const f = await fixture(pdf(), ["-raw", "input.pdf", "output.txt"]); const base = f.context.fs; let closed = false;
    f.context.fs = new Proxy(Object.create(base) as typeof base, { get(_target, key) {
      if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof base.openReadFile>>) => {
        const handle = await base.openReadFile!(...args);
        if (args[0] !== "/input.pdf") return handle;
        return { ...handle, stat: handle.stat.bind(handle), async read() { throw failure; }, async close() { closed = true; await handle.close(); throw new Error("secondary close failure"); } };
      };
      const value = Reflect.get(base, key); return typeof value === "function" ? value.bind(base) : value;
    } });
    await assert.rejects(async () => createPdftotextCommand().execute(f.context), error => error === failure);
    assert.equal(closed, true); assert.equal(f.stderr.length, 0); assert.equal(f.counts().published, 0);
    assert.equal(new TextDecoder().decode(await f.fs.readFile("/output.txt")), "old output"); await f.clean();
  });
}
for (const stdin of [false, true]) for (const html of [false, true]) {
  test(`retained raw budgets only the PDF at the exact configured input limit (stdin=${stdin}, html=${html})`, async () => {
    const input = pdf(), args = ["-raw", ...(html ? ["-htmlmeta"] : []), stdin ? "-" : "input.pdf", "output.txt"];
    const f = await fixture(input, args, stdin), totals: number[] = [];
    const result = await createPdftotextCommand({ limits: { maxInputBytes: input.length } }).execute({ ...f.context,
      inputBudget: { maxBytes: input.length, check(total) { assert.ok(total <= input.length); totals.push(total); } } });
    assert.equal(result.exitCode, 0); assert.equal(Math.max(...totals), input.length);
    assert.equal(f.counts().published, 1); await f.clean();
  });
}

for (const encoding of ["UTF-8", "UCS-2", "Latin1"]) for (const stdin of [false, true]) {
  test(`retained raw URLs preserve duplicates, existing text and page isolation (${encoding}, stdin=${stdin})`, async () => {
    const doc = PdfDocument.create();
    for (const text of ["https://example.test/already", "", "other page"]) {
      const page = doc.addPage(); if (text) page.drawText(text, { x: 10, y: 30, size: 10 });
      const links = ["https://example.test/already", "https://example.test/new", "https://example.test/new", "https://example.test/café"];
      dictSet(page.dict, "Annots", cosArray(links.map(uri => doc.cos.allocateObject(cosDict({
        Type: cosName("Annot"), Subtype: cosName("Link"), Rect: cosArray([0, 0, 30, 30].map(value => cosNumber(value))),
        A: cosDict({ S: cosName("URI"), URI: cosString(uri) }),
      })))));
    }
    const input = doc.save(), args = ["-raw", "-urls", "-enc", encoding, "-eol", "dos", stdin ? "-" : "input.pdf", stdin ? "-" : "output.txt"];
    const expected = await runPdftotextCli(args, new Map([["input.pdf", input]]), stdin ? input : undefined);
    const f = await fixture(input, args, stdin);
    assert.equal((await createPdftotextCommand({ limits: { maxInputBytes: input.length } }).execute(f.context)).exitCode, expected.exitCode);
    assert.deepEqual(stdin ? joined(f.stdout) : await f.fs.readFile("/output.txt"), encoded(expected.output, encoding));
    assert.deepEqual(f.counts(), { wholeReads: 0, payloadWrites: 0, published: stdin ? 0 : 1 }); await f.clean();
  });
}

for (const flags of [["-x", "40", "-W", "30"], ["-y", "690", "-H", "35"], ["-r", "144", "-x", "80", "-W", "60"], ["-cropbox"], ["-cropbox", "-x", "5", "-W", "30", "-htmlmeta"], ["-W", "0", "-H", "-1", "-urls"]]) {
  test(`retained raw crop preserves grouped words and bytes: ${flags.join(" ")}`, async () => {
    const doc = PdfDocument.load(pdf());
    const first = doc.getPage(0); dictSet(doc.cos.resolveDict(dictGet(first.dict, "Parent"))!, "CropBox", cosArray([30, 60, 150, 115].map(value => cosNumber(value))));
    const input = doc.save(), args = ["-raw", ...flags, "input.pdf", "output.txt"], expected = await runPdftotextCli(args, new Map([["input.pdf", input]]));
    const f = await fixture(input, args); assert.equal((await createPdftotextCommand().execute(f.context)).exitCode, expected.exitCode);
    assert.deepEqual(await f.fs.readFile("/output.txt"), new TextEncoder().encode(expected.output));
    assert.deepEqual(f.counts(), { wholeReads: 0, payloadWrites: 0, published: 1 }); await f.clean();
  });
}

for (const encoding of ["UTF-8", "UCS-2", "Latin1"]) for (const flags of [[], ["-htmlmeta", "-eol", "dos"], ["-cropbox", "-r", "144", "-eol", "mac"]]) {
  test(`retained raw TSV preserves page rows and encoding: ${encoding} ${flags.join(" ")}`, async () => {
    const doc = PdfDocument.load(pdf()); doc.setTitle("TSV <pages>");
    dictSet(doc.getPage(0).dict, "CropBox", cosArray([30, 60, 150, 115].map(value => cosNumber(value))));
    const input = doc.save(), args = ["-raw", "-tsv", "-enc", encoding, ...flags, "-", "output.txt"], expected = await runPdftotextCli(args, new Map(), input);
    const f = await fixture(input, args, true); assert.equal((await createPdftotextCommand().execute(f.context)).exitCode, expected.exitCode);
    assert.deepEqual(await f.fs.readFile("/output.txt"), encoded(expected.output, encoding));
    assert.deepEqual(f.counts(), { wholeReads: 0, payloadWrites: 0, published: 1 }); await f.clean();
  });
}

for (const mode of ["-bbox", "-bbox-layout"]) for (const flags of [[], ["-r", "144", "-cropbox", "-x", "5", "-W", "30"], ["-htmlmeta", "-eol", "dos", "-tsv"], ["-q", "-enc", "UCS-2"]]) {
  test(`retained raw bounding boxes preserve markup and diagnostics: ${mode} ${flags.join(" ")}`, async () => {
    const doc = PdfDocument.load(pdf()); doc.setTitle("Bounds <page>");
    dictSet(doc.getPage(0).dict, "CropBox", cosArray([30, 60, 150, 115].map(value => cosNumber(value))));
    const input = doc.save(), args = ["-raw", mode, ...flags, "input.pdf", "output.txt"], expected = await runPdftotextCli(args, new Map([["input.pdf", input]]));
    const f = await fixture(input, args); assert.equal((await createPdftotextCommand().execute(f.context)).exitCode, expected.exitCode);
    assert.deepEqual(await f.fs.readFile("/output.txt"), encoded(expected.output, flags.includes("UCS-2") ? "UCS-2" : "UTF-8"));
    assert.equal(new TextDecoder().decode(joined(f.stderr)), expected.stderr);
    assert.deepEqual(f.counts(), { wholeReads: 0, payloadWrites: 0, published: 1 }); await f.clean();
  });
}

for(const flags of [['-bbox'],['-bbox-layout'],['-layout','-bbox-layout'],['-colspacing','0.3','-bbox']])test(`retained ordered bounds preserve bytes: ${flags.join(' ')}`,async()=>{
  const doc=PdfDocument.create(),page=doc.addPage({width:200,height:200});
  page.drawText('R1',{x:150,y:80,size:10});page.drawText('L1',{x:0,y:80,size:10});page.drawText('R2',{x:150,y:65,size:10});page.drawText('L2',{x:0,y:65,size:10});
  const input=doc.save(),args=[...flags,'input.pdf','-'],expected=await runPdftotextCli(args,new Map([['input.pdf',input]])),f=await fixture(input,args);
  assert.equal((await createPdftotextCommand().execute(f.context)).exitCode,expected.exitCode);
  assert.equal(new TextDecoder().decode(joined(f.stdout)),expected.output);assert.equal(new TextDecoder().decode(joined(f.stderr)),expected.stderr);
  assert.deepEqual(f.counts(),{wholeReads:0,payloadWrites:0,published:0});await f.clean();
});
