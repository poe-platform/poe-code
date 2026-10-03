import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosDict, cosName, cosString, cosStream, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { bindFileOutputBudget } from "safe-bash-contracts/filesystem-output-budget";
import { createPdfdetachCommand, executePdfdetach } from "./index.js";

function pdf(attachments: readonly (readonly [string, string, string?])[]) {
  const doc = PdfDocument.create(); doc.addPage([8, 8]);
  const names = [];
  for (const [name, text, filter] of attachments) {
    const stream = doc.cos.allocateObject(cosStream(cosDict({ Type: cosName("EmbeddedFile"), ...(filter ? { Filter: cosName(filter) } : {}) }), new TextEncoder().encode(text)));
    const spec = doc.cos.allocateObject(cosDict({ Type: cosName("Filespec"), F: cosString(name), EF: cosDict({ F: stream }) }));
    names.push(cosString(name), spec);
  }
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "Names", cosDict({ EmbeddedFiles: cosDict({ Names: cosArray(names) }) }));
  return doc.save();
}
async function fixture(attachments: readonly (readonly [string, string, string?])[], args = ["-saveall", "-o", "/work", "in.pdf"]) {
  const fs = createMemoryFileSystem(); await fs.mkdir("/work"); await fs.mkdir("/tmp");
  const bytes = pdf(attachments); await fs.writeFile("/work/in.pdf", bytes);
  const published: string[] = []; let reads = 0; let peakRead = 0;
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return async () => { throw new Error("payload-wide I/O forbidden"); };
    if (key === "publishStagedFile") return async (...args: Parameters<typeof fs.publishStagedFile>) => { published.push(args[1]); return target.publishStagedFile(...args); };
    if (key === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => {
      const handle = await target.openReadFile(...args);
      return { ...handle, async read(...range: Parameters<typeof handle.read>) { reads++; peakRead = Math.max(peakRead, range[1]); return handle.read(...range); } };
    };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  const carrier = createCommandArguments(args); const controller = new AbortController();
  let errors = "", stdout = "";
  const context = { command: "pdfdetach", args: carrier.args, argumentValues: carrier, cwd: "/work", env: {}, fs: injected,
    signal: controller.signal, registerCleanup() {}, stdin: { async *[Symbol.asyncIterator]() { for (let at = 0; at < bytes.length; at += 32) yield bytes.subarray(at, at + 32); } },
    stdout: { async write(data: Uint8Array) { stdout += new TextDecoder().decode(data); } }, stderr: { async write(data: Uint8Array) { errors += new TextDecoder().decode(data); } },
  } as unknown as CommandContext;
  return { fs, context, bytes, published, controller, get errors() { return errors; }, get stdout() { return stdout; }, get reads() { return reads; }, get peakRead() { return peakRead; } };
}

it("extracts colliding attachments through retained reads and atomic streamed publication", async () => {
  const f = await fixture([["a/x.txt", "old"], ["y.txt", "middle"], ["b/x.txt", "new"]]);
  const result = await createPdfdetachCommand().execute(f.context);
  assert.equal(result.exitCode, 0, f.errors);
  assert.deepEqual(f.published, ["/work/x.txt", "/work/y.txt"]);
  assert.equal(new TextDecoder().decode(await f.fs.readFile("/work/x.txt")), "new");
  assert.equal(new TextDecoder().decode(await f.fs.readFile("/work/y.txt")), "middle");
  assert.deepEqual(await f.fs.readdir("/tmp"), []);
});

it("admits input size before any payload read and does not charge rereads as new input", async () => {
  const f = await fixture([["x", "hello"]]);
  await assert.rejects(async () => createPdfdetachCommand({ limits: { maxInputBytes: f.bytes.length - 1 } }).execute(f.context), /input byte limit/);
  assert.equal(f.reads, 0);
  const result = await createPdfdetachCommand({ limits: { maxInputBytes: f.bytes.length } }).execute(f.context);
  assert.equal(result.exitCode, 0, f.errors);
});

it("stages stdin and lists through the same SDK handler", async () => {
  const f = await fixture([["x", "hello"], ["y", "world"]], ["-list", "-"]);
  assert.equal((await executePdfdetach(f.context)).exitCode, 0, f.errors);
  assert.equal(f.stdout, "2 embedded files\n1: x\n2: y\n");
  assert.deepEqual(await f.fs.readdir("/tmp"), []);
});

it("finishes validating later attachments before publishing any selected output", async () => {
  const f = await fixture([["x", "okay"], ["y", "broken", "Unsupported"]], ["-save", "1", "in.pdf"]);
  await assert.rejects(executePdfdetach(f.context), /filter/i);
  assert.deepEqual(f.published, []); assert.deepEqual(await f.fs.readdir("/tmp"), []);
});

it("charges shared output budgets before staging writes and preserves the destination on failure", async () => {
  const f = await fixture([["x", "hello"]]); await f.fs.writeFile("/work/x", new TextEncoder().encode("original"));
  const failure = new Error("shared output exhausted");
  bindFileOutputBudget(f.context, () => ({ async write() { throw failure; } }));
  await assert.rejects(executePdfdetach(f.context), error => error === failure);
  assert.equal(new TextDecoder().decode(await f.fs.readFile("/work/x")), "original");
  assert.deepEqual(f.published, []); assert.deepEqual(await f.fs.readdir("/tmp"), []);
  assert.deepEqual((await f.fs.readdir("/work")).map(entry => entry.name).sort(), ["in.pdf", "x"]);
});

it("observes cancellation after an admitted sink write without publishing partial output", async () => {
  const f = await fixture([["x", "payload".repeat(20000)]]); let pending = 0; let peak = 0;
  const failure = new Error("cancel publication");
  bindFileOutputBudget(f.context, sink => ({ async write(bytes) {
    pending += bytes.length; peak = Math.max(peak, pending);
    await Promise.resolve(); await sink.write(bytes); pending -= bytes.length;
    f.controller.abort(failure);
  } }));
  await assert.rejects(executePdfdetach(f.context), error => error === failure);
  assert.ok(peak <= 65536); assert.ok(f.peakRead <= 65536); assert.equal(pending, 0);
  assert.deepEqual(f.published, []); assert.deepEqual(await f.fs.readdir("/tmp"), []);
  assert.deepEqual((await f.fs.readdir("/work")).map(entry => entry.name), ["in.pdf"]);
});
