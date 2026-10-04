import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createPdfseparateCommand, runPdfseparateCli } from "./index.js";
function pdf() { const doc = PdfDocument.create(); doc.setTitle("Separate pages"); for (let i = 0; i < 3; i++) doc.addPage([100, 200]).drawText(`Page ${i}`, { x: 10, y: 20 }); return doc.save(); }
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
  const context = { command: "pdfseparate", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array, void, unknown> {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr.push(bytes.slice()); } } };
  return { fs, context, controller, stderr, counts: () => ({ reads, writes, published }), async clean() { assert.deepEqual(await fs.readdir("/scratch"), []); } };
}
for (const args of [["in.pdf", "page-%d.pdf"], ["-f", "2", "-l", "3", "in.pdf", "%%page-%03d.pdf"], ["-f", "2", "-l", "2", "in.pdf", "in.pdf"]]) {
  it(`streams extraction with exact bytes and retained publication: ${args.join(" ")}`, async () => {
    const input = pdf(), files = new Map([["in.pdf", input]]), expected = await runPdfseparateCli(args, files), f = await fixture(input, args);
    assert.equal((await createPdfseparateCommand().execute(f.context)).exitCode, expected.exitCode);
    for (const [name, bytes] of files) assert.deepEqual(await f.fs.readFile("/" + name), bytes);
    assert.equal(new TextDecoder().decode(Buffer.concat(f.stderr)), expected.stderr);
    assert.equal(f.counts().reads, 0); assert.equal(f.counts().writes, 0); assert.ok(f.counts().published > 0); await f.clean();
  });
}

for (const args of [["--help"], ["--version"], [], ["-f", "bad", "in.pdf", "out"], ["-l", "8", "in.pdf", "out-%d.pdf"], ["-f", "4", "in.pdf", "out-%d.pdf"], ["in.pdf", "out.pdf"], ["missing.pdf", "out-%d.pdf"]]) {
  it(`preserves diagnostics and publishes nothing: ${args.join(" ")}`, async () => {
    const input = pdf(), expected = await runPdfseparateCli(args, new Map([["in.pdf", input]])), f = await fixture(input, args);
    assert.equal((await createPdfseparateCommand().execute(f.context)).exitCode, expected.exitCode);
    assert.equal(new TextDecoder().decode(Buffer.concat(f.stderr)), expected.stderr);
    assert.deepEqual(f.counts(), { reads: 0, writes: 0, published: 0 }); await f.clean();
  });
}
for (const limits of [{ maxInputBytes: 1 }, { maxOutputBytes: 1 }, { maxPages: 1 }, { maxObjects: 1 }]) {
  it(`rejects budgets before publication: ${JSON.stringify(limits)}`, async () => {
    const f = await fixture(pdf(), ["in.pdf", "out-%d.pdf"]);
    await assert.rejects(async () => createPdfseparateCommand({ limits }).execute(f.context), /limit/i);
    assert.deepEqual(f.counts(), { reads: 0, writes: 0, published: 0 }); await f.clean();
  });
}
it("accepts an exact input budget without charging scratch reads", async () => {
  const input = pdf(), f = await fixture(input, ["in.pdf", "out-%d.pdf"]);
  assert.equal((await createPdfseparateCommand({ limits: { maxInputBytes: input.length } }).execute(f.context)).exitCode, 0); await f.clean();
});
it("retains password and damaged-input diagnostics", async () => {
  const doc = PdfDocument.create(); doc.addPage();
  for (const input of [new TextEncoder().encode("broken"), doc.save({ encrypt: { userPassword: "reader", ownerPassword: "owner" } })]) {
    const args = ["in.pdf", "out-%d.pdf"], expected = await runPdfseparateCli(args, new Map([["in.pdf", input]])), f = await fixture(input, args);
    assert.equal((await createPdfseparateCommand().execute(f.context)).exitCode, expected.exitCode);
    assert.equal(new TextDecoder().decode(Buffer.concat(f.stderr)), expected.stderr); await f.clean();
  }
});
it("cleans scratch after cancellation during retained extraction", async () => {
  const f = await fixture(pdf(), ["in.pdf", "out-%d.pdf"]), reason = new Error("cancel copy");
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
  try { await assert.rejects(async () => createPdfseparateCommand().execute({ ...f.context, fs }), error => error === reason); }
  finally { clearTimeout(timer); }
  assert.equal(f.counts().published, 0); await f.clean();
});
it("leaves an existing output intact when its staged writer fails", async () => {
  const f = await fixture(pdf(), ["-f", "1", "-l", "1", "in.pdf", "out.pdf"]); await f.fs.writeFile("/out.pdf", new TextEncoder().encode("original"));
  const base = f.context.fs, failure = new Error("write failure");
  const fs = new Proxy(base, { get(target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof base.createStagedFile>>) => {
      const staged = await base.createStagedFile!(...args); if (args[1] !== "output") return staged;
      return { ...staged, writer: { ...staged.writer!, write: async () => { throw failure; } } };
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  await assert.rejects(async () => createPdfseparateCommand().execute({ ...f.context, fs }), error => error === failure);
  assert.equal(new TextDecoder().decode(await f.fs.readFile("/out.pdf")), "original"); assert.equal(f.counts().published, 0); await f.clean();
});
it("awaits bounded output chunks with a slow retained writer", async () => {
  const doc = PdfDocument.create(); doc.addPage().drawText("Slow output", { x: 10, y: 10 });
  const f = await fixture(doc.save(), ["in.pdf", "out-%d.pdf"]), base = f.context.fs;
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
  assert.equal((await createPdfseparateCommand().execute({ ...f.context, fs })).exitCode, 0);
  assert.ok(writes > 0); assert.ok(peak <= 65536); assert.equal(outstanding, 0); await f.clean();
});
