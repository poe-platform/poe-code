// Output failure statuses: qpdf 12.4.2, pdftk-java 3.3.3, Poppler 26.09.0.
import assert from "node:assert/strict";
import { it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosDict, cosName, cosString, cosStream, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createPdftoppmCommand, createPdftocairoCommand } from "./index.js";

function fixture(name = "payload.txt") {
  const doc = PdfDocument.create();
  const page = doc.addPage([8, 8]);
  page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([255, 0, 0])), { x: 0, y: 0, width: 8, height: 8 });
  const stream = doc.cos.allocateObject(cosStream(cosDict({ Type: cosName("EmbeddedFile") }), new TextEncoder().encode("payload")));
  const spec = doc.cos.allocateObject(cosDict({ Type: cosName("Filespec"), F: cosString(name), UF: cosString(name), EF: cosDict({ F: stream }) }));
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "Names", cosDict({ EmbeddedFiles: cosDict({ Names: cosArray([cosString(name), spec]) }) }));
  return doc.save();
}

async function execute(command: ReturnType<typeof createPdftoppmCommand>, args: string[], _missing = false, attachment = "payload.txt") {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/in.pdf", fixture(attachment));
  await fs.writeFile("/work/-in.pdf", fixture(attachment));
  for (const name of ["out.pdf", "out.html", "out", "out-%d.pdf", "cat", "1", "output"]) await fs.writeFile(`/work/${name}`, new Uint8Array(10000));
  const reads: string[] = [], errors: Uint8Array[] = [];
  const carrier = createCommandArguments(args);
  const context = {
    command: command.name, args: carrier.args, argumentValues: carrier, cwd: "/work", env: {},
    signal: new AbortController().signal, registerCleanup() {},
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } },
    fs: new Proxy(Object.create(fs) as typeof fs, { get(_target, key) {
      if (key === "readFile") return async (...args: Parameters<typeof fs.readFile>) => { reads.push(args[0]); return fs.readFile(...args); };
      if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof fs.openReadFile>>) => { if (args[0].startsWith("/work/")) reads.push(args[0]); return fs.openReadFile!(...args); };
      const value = Reflect.get(fs, key); return typeof value === "function" ? value.bind(fs) : value;
    } })
  } as unknown as CommandContext;
  const result = await command.execute(context);
  return { result, reads, fs, stderr: Buffer.concat(errors).toString() };
}

it("Pdftoppm reads only input operands", async () => {
  const { result, reads, stderr } = await execute(createPdftoppmCommand(), ["-scale-to", "8", "-png", "in.pdf", "out"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual([...new Set(reads)], ["/work/in.pdf"]);
});

it("Pdftoppm reports missing output parents without creating directories", async () => {
  const { result, fs, stderr } = await execute(createPdftoppmCommand(), ["-scale-to", "8", "-png", "in.pdf", "/missing/out"], true);
  assert.equal(result.exitCode, 1);
  assert.ok(stderr.length > 0);
  await assert.rejects(fs.stat("/missing"), { code: "ENOENT" });
});

it("Pdftocairo reads only input operands", async () => {
  const { result, reads, stderr } = await execute(createPdftocairoCommand(), ["-scale-to", "8", "-png", "in.pdf", "out"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual([...new Set(reads)], ["/work/in.pdf"]);
});

it("Pdftocairo reports missing output parents without creating directories", async () => {
  const { result, fs, stderr } = await execute(createPdftocairoCommand(), ["-scale-to", "8", "-png", "in.pdf", "/missing/out"], true);
  assert.equal(result.exitCode, 2);
  assert.ok(stderr.length > 0);
  await assert.rejects(fs.stat("/missing"), { code: "ENOENT" });
});

for (const args of [[], ["-"]]) {
  it(`reports empty stdin for pdftoppm ${args.join(" ")}`, async () => {
    const { result, stderr } = await execute(createPdftoppmCommand(), args);
    assert.equal(result.exitCode, 1);
    assert.ok(stderr.includes("Syntax Error: Document stream is empty"), stderr);
  });
}

it("normalizes dot segments before VFS access", async () => {
  const { result, reads, stderr } = await execute(createPdftoppmCommand(), ["-scale-to", "8", "missing/../in.pdf", "missing/../out"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(reads, ["/work/in.pdf"]);
});

it("stages dash-prefixed operands after --", async () => {
  const { result, reads, stderr } = await execute(createPdftoppmCommand(), ["-scale-to", "8", "--", "-in.pdf", "out"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(reads, ["/work/-in.pdf"]);
});

it("pdftocairo stages dash-prefixed operands after --", async () => {
 const { result, stderr } = await execute(createPdftocairoCommand(), ["-png", "-scale-to", "8", "--", "-in.pdf", "out"]);
 assert.equal(result.exitCode, 0, stderr);
});
