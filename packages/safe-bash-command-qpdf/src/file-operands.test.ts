// Output failure statuses: qpdf 12.4.2, pdftk-java 3.3.3, Poppler 26.09.0.
import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosDict, cosName, cosString, cosStream, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createQpdfCommand } from "./index.js";

function fixture(name = "payload.txt") {
  const doc = PdfDocument.create();
  const page = doc.addPage([8, 8]);
  page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([255, 0, 0])), { x: 0, y: 0, width: 8, height: 8 });
  const stream = doc.cos.allocateObject(cosStream(cosDict({ Type: cosName("EmbeddedFile") }), new TextEncoder().encode("payload")));
  const spec = doc.cos.allocateObject(cosDict({ Type: cosName("Filespec"), F: cosString(name), UF: cosString(name), EF: cosDict({ F: stream }) }));
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "Names", cosDict({ EmbeddedFiles: cosDict({ Names: cosArray([cosString(name), spec]) }) }));
  return doc.save();
}

async function execute(command: ReturnType<typeof createQpdfCommand>, args: string[], _missing = false, attachment = "payload.txt") {
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
    fs: new Proxy(fs, { get(target, key) {
      if (key === "readFile" || key === "openReadFile") return async (...args: unknown[]) => {
        if (String(args[0]).startsWith("/work/")) reads.push(String(args[0]));
        return Reflect.apply(Reflect.get(target, key), target, args);
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } })
  } as unknown as CommandContext;
  const result = await command.execute(context);
  return { result, reads, fs, stderr: Buffer.concat(errors).toString() };
}

it("Qpdf reads only input operands", async () => {
  const { result, reads, stderr } = await execute(createQpdfCommand(), ["in.pdf", "out.pdf"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual([...new Set(reads)], ["/work/in.pdf"]);
});

it("Qpdf creates missing output parents", async () => {
  const { result, fs, stderr } = await execute(createQpdfCommand(), ["in.pdf", "/missing/nested/out.pdf"], true);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(PdfDocument.load(await fs.readFile("/missing/nested/out.pdf")).pageCount, 1);
});

it("does not read qpdf page ranges as files", async () => {
  const { result, reads, stderr } = await execute(createQpdfCommand(), ["in.pdf", "--pages", ".", "1", "--", "out.pdf"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(reads, ["/work/in.pdf"]);
});
it("overwrites an existing output without charging its previous contents", async () => {
  const { result, fs, stderr } = await execute(createQpdfCommand({ limits: { maxInputBytes: fixture().byteLength } }), ["in.pdf", "out.pdf"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(PdfDocument.load(await fs.readFile("/work/out.pdf")).pageCount, 1);
});

it("normalizes dot segments before VFS access", async () => {
  const { result, reads, stderr } = await execute(createQpdfCommand(), ["missing/../in.pdf", "missing/../out.pdf"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(reads, ["/work/in.pdf"]);
});
