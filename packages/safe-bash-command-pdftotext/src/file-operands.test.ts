// Output failure statuses: qpdf 12.4.2, pdftk-java 3.3.3, Poppler 26.09.0.
import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { PdfDocument, cosArray, cosDict, cosName, cosString, cosStream, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createPdftohtmlCommand, createPdftotextCommand } from "./index.js";

function fixture(name = "payload.txt") {
  const doc = PdfDocument.create();
  const page = doc.addPage([8, 8]);
  page.drawText("café", { x: 0, y: 4, size: 2 });
  page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([255, 0, 0])), { x: 0, y: 0, width: 8, height: 8 });
  const stream = doc.cos.allocateObject(cosStream(cosDict({ Type: cosName("EmbeddedFile") }), new TextEncoder().encode("payload")));
  const spec = doc.cos.allocateObject(cosDict({ Type: cosName("Filespec"), F: cosString(name), UF: cosString(name), EF: cosDict({ F: stream }) }));
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "Names", cosDict({ EmbeddedFiles: cosDict({ Names: cosArray([cosString(name), spec]) }) }));
  return doc.save();
}

async function execute(command: ReturnType<typeof createPdftohtmlCommand>, args: string[], missing = false, attachment = "payload.txt") {
  const volume = new Volume();
  volume.mkdirSync("/work");
  volume.writeFileSync("/work/in.pdf", fixture(attachment));
  volume.writeFileSync("/work/-in.pdf", fixture(attachment));
  for (const name of ["out.pdf", "out.html", "out", "out-%d.pdf", "cat", "1", "output"]) volume.writeFileSync(`/work/${name}`, new Uint8Array(10000));
  const reads: string[] = [], errors: Uint8Array[] = [], output: Uint8Array[] = [];
  const carrier = createCommandArguments(args);
  const context = {
    command: command.name, args: carrier.args, argumentValues: carrier, cwd: "/work", env: {},
    signal: new AbortController().signal, registerCleanup() {},
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } },
    fs: {
      async readFile(path: string) { reads.push(path); return new Uint8Array(volume.readFileSync(path) as Buffer); },
      async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
    }
  } as unknown as CommandContext;
  if (!missing && command.name === "pdfdetach") { volume.unlinkSync("/work/out"); volume.mkdirSync("/work/out"); }
  const result = await command.execute(context);
  return { result, reads, volume, stdout: Buffer.concat(output), stderr: Buffer.concat(errors).toString() };
}

it("Pdftohtml reads only input operands", async () => {
  const { result, reads, stderr } = await execute(createPdftohtmlCommand(), ["in.pdf", "out.html"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual([...new Set(reads)], ["/work/in.pdf"]);
});

it("Pdftohtml reports missing output parents without creating directories", async () => {
  const { result, volume, stderr } = await execute(createPdftohtmlCommand(), ["in.pdf", "/missing/out.html"], true);
  assert.equal(result.exitCode, 0);
  assert.ok(stderr.length > 0);
  assert.equal(volume.existsSync("/missing"), false);
});

it("normalizes dot segments before VFS access", async () => {
  const { result, reads, stderr } = await execute(createPdftohtmlCommand(), ["missing/../in.pdf", "missing/../out.html"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(reads, ["/work/in.pdf"]);
});

it("stages dash-prefixed operands after --", async () => {
  const { result, reads, stderr } = await execute(createPdftohtmlCommand(), ["--", "-in.pdf", "out.html"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(reads, ["/work/-in.pdf"]);
});

for (const encoding of ["Latin1", "UCS-2"]) {
  it(`writes ${encoding} bytes without UTF-8 re-encoding`, async () => {
    const { result, volume, stderr } = await execute(createPdftotextCommand(), ["-enc", encoding, "in.pdf", "out.txt"]);
    assert.equal(result.exitCode, 0, stderr);
    const bytes = new Uint8Array(volume.readFileSync("/work/out.txt") as Buffer);
    if (encoding === "Latin1") {
      assert.ok(bytes.includes(0xe9));
      assert.equal(bytes.includes(0xc3), false);
    } else {
      assert.deepEqual([...bytes.slice(0, 2)], [0xfe, 0xff]);
      assert.equal(bytes.length % 2, 0);
      assert.ok(Buffer.from(bytes).includes(Buffer.from([0, 0xe9])));
    }
  });
}
it("pdftotext normalizes both input and output paths", async () => {
 const { result, reads, volume, stderr } = await execute(createPdftotextCommand(), ["missing/../in.pdf", "missing/../out.txt"]);
 assert.equal(result.exitCode, 0, stderr);
 assert.deepEqual(reads, ["/work/in.pdf"]);
 assert.ok(volume.existsSync("/work/out.txt"));
});

for (const encoding of ["UTF-8", "ASCII7", "Latin1", "UCS-2"]) {
  it(`uses identical ${encoding} bytes for files and stdout`, async () => {
    const file = await execute(createPdftotextCommand(), ["-enc", encoding, "in.pdf", "out.txt"]);
    const pipe = await execute(createPdftotextCommand(), ["-enc", encoding, "in.pdf", "-"]);
    assert.equal(file.result.exitCode, 0, file.stderr);
    assert.equal(pipe.result.exitCode, 0, pipe.stderr);
    assert.deepEqual(pipe.stdout, file.volume.readFileSync("/work/out.txt"));
  });
}
it("pdftotext does not create missing output parents", async () => {
  const { result, volume } = await execute(createPdftotextCommand(), ["in.pdf", "/missing/out.txt"]);
  assert.equal(result.exitCode, 2);
  assert.equal(volume.existsSync("/missing"), false);
});
