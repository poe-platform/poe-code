import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createPdfuniteCommand, runPdfuniteCli } from "./index.js";
function pdf() { const doc = PdfDocument.create(); doc.setTitle("Merged pages"); for (let i = 0; i < 3; i++) doc.addPage([100, 200]).drawText(`Page ${i}`, { x: 10, y: 20 }); return doc.save(); }
async function fixture(input: Uint8Array, args: string[]) {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  let reads = 0, writes = 0, published = 0; const stderr: Uint8Array[] = [];
  const guarded = new Proxy(Object.create(fs) as typeof fs, { get(_target, key) {
    if (key === "readFile") return async () => { reads++; throw new Error("whole reads forbidden"); };
    if (key === "writeFile") return async () => { writes++; throw new Error("whole writes forbidden"); };
    if (key === "publishStagedFile") return async (...args: Parameters<NonNullable<typeof fs.publishStagedFile>>) => { published++; return fs.publishStagedFile!(...args); };
    const value = Reflect.get(fs, key); return typeof value === "function" ? value.bind(fs) : value;
  } });
  const carrier = createCommandArguments(args), controller = new AbortController();
  const context = { command: "pdfunite", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array, void, unknown> {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr.push(bytes.slice()); } } };
  return { fs, context, controller, stderr, counts: () => ({ reads, writes, published }), async clean() { assert.deepEqual(await fs.readdir("/scratch"), []); } };
}
for (const args of [["in.pdf", "in.pdf", "out.pdf"], ["in.pdf", "in.pdf", "in.pdf"]]) {
  it(`merges sequential retained inputs with exact output: ${args.join(" ")}`, async () => {
    const input = pdf(), files = new Map([["in.pdf", input]]), expected = await runPdfuniteCli(args, files), f = await fixture(input, args);
    assert.equal((await createPdfuniteCommand().execute(f.context)).exitCode, expected.exitCode);
    assert.deepEqual(await f.fs.readFile("/" + args.at(-1)!), files.get(args.at(-1)!)!);
    assert.equal(new TextDecoder().decode(Buffer.concat(f.stderr)), expected.stderr);
    assert.deepEqual(f.counts(), { reads: 0, writes: 0, published: 1 }); await f.clean();
  });
}
for (const args of [["--help"], ["--version"], [], ["in.pdf"], ["in.pdf", "out"], ["-unknown", "--help"], ["missing.pdf", "in.pdf", "out.pdf"]]) {
  it(`preserves diagnostics without whole-file I/O: ${args.join(" ")}`, async () => {
    const input = pdf(), expected = await runPdfuniteCli(args, new Map([["in.pdf", input]])), f = await fixture(input, args);
    assert.equal((await createPdfuniteCommand().execute(f.context)).exitCode, expected.exitCode);
    assert.equal(new TextDecoder().decode(Buffer.concat(f.stderr)), expected.stderr);
    assert.deepEqual(f.counts(), { reads: 0, writes: 0, published: 0 }); await f.clean();
  });
}
for (const limits of [{ maxInputBytes: 1 }, { maxOutputBytes: 1 }, { maxPages: 1 }, { maxObjects: 1 }]) {
  it(`rejects budgets before publication: ${JSON.stringify(limits)}`, async () => {
    const f = await fixture(pdf(), ["in.pdf", "in.pdf", "out.pdf"]);
    await assert.rejects(async () => createPdfuniteCommand({ limits }).execute(f.context), /limit/i);
    assert.deepEqual(f.counts(), { reads: 0, writes: 0, published: 0 }); await f.clean();
  });
}
it("charges repeated operands once and excludes scratch reads", async () => {
  const input = pdf(), f = await fixture(input, ["in.pdf", "in.pdf", "out.pdf"]);
  assert.equal((await createPdfuniteCommand({ limits: { maxInputBytes: input.length } }).execute(f.context)).exitCode, 0); await f.clean();
});
it("preserves encrypted and damaged input diagnostics", async () => {
  const doc = PdfDocument.create(); doc.addPage();
  for (const input of [new TextEncoder().encode("broken"), ...["", "reader"].map(userPassword => doc.save({ encrypt: { userPassword, ownerPassword: "owner" } }))]) {
    const args = ["in.pdf", "in.pdf", "out.pdf"], expected = await runPdfuniteCli(args, new Map([["in.pdf", input]])), f = await fixture(input, args);
    assert.equal((await createPdfuniteCommand().execute(f.context)).exitCode, expected.exitCode);
    assert.equal(new TextDecoder().decode(Buffer.concat(f.stderr)), expected.stderr); await f.clean();
  }
});

it("cleans scratch after cancellation during retained merging", async () => {
  const f = await fixture(pdf(), ["in.pdf", "in.pdf", "out.pdf"]), reason = new Error("cancel copy");
  const base = f.context.fs;
  const fs = new Proxy(base, { get(target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof base.createStagedFile>>) => {
      const staged = await base.createStagedFile!(...args);
      if (args[1] === "bytes") f.controller.abort(reason);
      return staged;
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const timer = setTimeout(() => f.controller.abort(reason), 0);
  try { await assert.rejects(async () => createPdfuniteCommand().execute({ ...f.context, fs }), error => error === reason); }
  finally { clearTimeout(timer); }
  assert.equal(f.counts().published, 0); await f.clean();
});
it("leaves an existing output intact when its staged writer fails", async () => {
  const f = await fixture(pdf(), ["in.pdf", "in.pdf", "out.pdf"]); await f.fs.writeFile("/out.pdf", new TextEncoder().encode("original"));
  const base = f.context.fs, failure = new Error("write failure");
  const fs = new Proxy(base, { get(target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof base.createStagedFile>>) => {
      const staged = await base.createStagedFile!(...args); if (args[1] !== "output") return staged;
      return { ...staged, writer: { ...staged.writer!, write: async () => { throw failure; } } };
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  await assert.rejects(async () => createPdfuniteCommand().execute({ ...f.context, fs }), error => error === failure);
  assert.equal(new TextDecoder().decode(await f.fs.readFile("/out.pdf")), "original"); assert.equal(f.counts().published, 0); await f.clean();
});
it("awaits bounded output chunks with a slow retained writer", async () => {
  const doc = PdfDocument.create(); doc.addPage().drawText("Slow output", { x: 10, y: 10 });
  const f = await fixture(doc.save(), ["in.pdf", "in.pdf", "out.pdf"]), base = f.context.fs;
  let outstanding = 0, peak = 0, writes = 0;
  const fs = new Proxy(base, { get(target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof base.createStagedFile>>) => {
      const staged = await base.createStagedFile!(...args); if (args[1] !== "output") return staged;
      const writer = staged.writer!;
      return { ...staged, writer: { ...writer, write: async (bytes: Uint8Array, options: Parameters<typeof writer.write>[1]) => {
        outstanding += bytes.length; peak = Math.max(peak, outstanding); writes++; assert.ok(bytes.length <= 65536);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        try { return await writer.write(bytes, options); } finally { outstanding -= bytes.length; }
      }, finish: writer.finish.bind(writer) } };
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  assert.equal((await createPdfuniteCommand().execute({ ...f.context, fs })).exitCode, 0);
  assert.ok(writes > 0); assert.ok(peak <= 65536); assert.equal(outstanding, 0); await f.clean();
});

it("preserves metadata, flattened outlines, labels and duplicate attachments together", async () => {
  const { cosArray, cosDict, cosName, cosNumber, cosString, cosStream, dictSet } = await import("@poe-code/pdf-ast");
  const doc = PdfDocument.create(); doc.setTitle("Merged navigation"); const page = doc.addPage([100, 100]);
  const catalog = doc.cos.resolveDict(doc.cos.rootRef)!;
  const bookmark = doc.cos.allocateObject(cosDict({ Title: cosString("Résumé 日本"), Dest: cosArray([page.ref, cosName("Fit")]) }));
  dictSet(catalog, "Outlines", cosDict({ First: bookmark }));
  dictSet(catalog, "PageLabels", cosDict({ Nums: cosArray([cosNumber(0), cosDict({ P: cosString("日本"), S: cosName("r") })]) }));
  const embedded = doc.cos.allocateObject(cosStream(new TextEncoder().encode("payload".repeat(10000))));
  dictSet(catalog, "Names", cosDict({ EmbeddedFiles: cosDict({ Names: cosArray([cosString("日本.txt"), cosDict({ F: cosString("日本.txt"), EF: cosDict({ F: embedded }) })]) }) }));
  const input = doc.save(), args = ["in.pdf", "in.pdf", "out.pdf"], files = new Map([["in.pdf", input]]), expected = await runPdfuniteCli(args, files), f = await fixture(input, args);
  assert.equal((await createPdfuniteCommand().execute(f.context)).exitCode, expected.exitCode);
  assert.deepEqual(await f.fs.readFile("/out.pdf"), files.get("out.pdf")); await f.clean();
});
it("checks the caller input budget before reading source bytes", async () => {
  const f = await fixture(pdf(), ["in.pdf", "in.pdf", "out.pdf"]), base = f.context.fs; let reads = 0;
  const fs = new Proxy(base, { get(target, key) {
    if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof base.openReadFile>>) => {
      const handle = await base.openReadFile!(...args);
      return new Proxy(handle, { get(owner, property) {
        if (property === "read") return async (...args: Parameters<typeof handle.read>) => { reads++; return handle.read(...args); };
        const value = Reflect.get(owner, property); return typeof value === "function" ? value.bind(owner) : value;
      } });
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  await assert.rejects(async () => createPdfuniteCommand().execute({ ...f.context, fs, inputBudget: { maxBytes: 1, check() {} } }), /limit/i);
  assert.equal(reads, 0); assert.equal(f.counts().published, 0); await f.clean();
});

it("closes each source before opening the next operand", async () => {
  const f = await fixture(pdf(), ["in.pdf", "second.pdf", "out.pdf"]); await f.fs.writeFile("/second.pdf", pdf()); const base = f.context.fs;
  let active = 0, opened = 0;
  const fs = new Proxy(base, { get(target, key) {
    if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof base.openReadFile>>) => {
      const handle = await base.openReadFile!(...args);
      if (args[0] !== "/in.pdf" && args[0] !== "/second.pdf") return handle;
      assert.equal(active, 0); active++; opened++; let closed = false;
      return new Proxy(handle, { get(owner, property) {
        if (property === "close") return async () => { if (!closed) { active--; closed = true; } await handle.close(); };
        const value = Reflect.get(owner, property); return typeof value === "function" ? value.bind(owner) : value;
      } });
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  assert.equal((await createPdfuniteCommand().execute({ ...f.context, fs })).exitCode, 0);
  assert.equal(opened, 2); assert.equal(active, 0); await f.clean();
});
