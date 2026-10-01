// Output failure statuses: qpdf 12.4.2, pdftk-java 3.3.3, Poppler 26.09.0.
import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { PdfDocument, cosArray, cosDict, cosName, cosString, cosStream, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createPdfinfoCommand, createPdfuniteCommand, createPdfseparateCommand, createPdfdetachCommand } from "./index.js";

function fixture(name = "payload.txt") {
  const doc = PdfDocument.create();
  const page = doc.addPage([8, 8]);
  page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([255, 0, 0])), { x: 0, y: 0, width: 8, height: 8 });
  const stream = doc.cos.allocateObject(cosStream(cosDict({ Type: cosName("EmbeddedFile") }), new TextEncoder().encode("payload")));
  const spec = doc.cos.allocateObject(cosDict({ Type: cosName("Filespec"), F: cosString(name), UF: cosString(name), EF: cosDict({ F: stream }) }));
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "Names", cosDict({ EmbeddedFiles: cosDict({ Names: cosArray([cosString(name), spec]) }) }));
  return doc.save();
}

async function execute(command: ReturnType<typeof createPdfuniteCommand>, args: string[], missing = false, attachment = "payload.txt") {
  const volume = new Volume();
  volume.mkdirSync("/work");
  volume.writeFileSync("/work/in.pdf", fixture(attachment));
  volume.writeFileSync("/work/-in.pdf", fixture(attachment));
  for (const name of ["out.pdf", "out.html", "out", "out-%d.pdf", "cat", "1", "output"]) volume.writeFileSync(`/work/${name}`, new Uint8Array(10000));
  const reads: string[] = [], errors: Uint8Array[] = [];
  const carrier = createCommandArguments(args);
  const context = {
    command: command.name, args: carrier.args, argumentValues: carrier, cwd: "/work", env: {},
    signal: new AbortController().signal, registerCleanup() {},
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } },
    fs: {
      async stat(path: string) { return { type: volume.statSync(path).isDirectory() ? "directory" : "file" }; },
      async readFile(path: string) { reads.push(path); return new Uint8Array(volume.readFileSync(path) as Buffer); },
      async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
    }
  } as unknown as CommandContext;
  if (!missing && command.name === "pdfdetach") { volume.unlinkSync("/work/out"); volume.mkdirSync("/work/out"); }
  const result = await command.execute(context);
  return { result, reads, volume, stderr: Buffer.concat(errors).toString() };
}

it("Pdfunite reads only input operands", async () => {
  const { result, reads, stderr } = await execute(createPdfuniteCommand(), ["in.pdf", "in.pdf", "out.pdf"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual([...new Set(reads)], ["/work/in.pdf"]);
});

it("Pdfunite reports missing output parents without creating directories", async () => {
  const { result, volume, stderr } = await execute(createPdfuniteCommand(), ["in.pdf", "in.pdf", "/missing/out.pdf"], true);
  assert.equal(result.exitCode, 255);
  assert.ok(stderr.length > 0);
  assert.equal(volume.existsSync("/missing"), false);
});

it("Pdfseparate reads only input operands", async () => {
  const { result, reads, stderr } = await execute(createPdfseparateCommand(), ["in.pdf", "out-%d.pdf"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual([...new Set(reads)], ["/work/in.pdf"]);
});

it("Pdfseparate reports missing output parents without creating directories", async () => {
  const { result, volume, stderr } = await execute(createPdfseparateCommand(), ["in.pdf", "/missing/out-%d.pdf"], true);
  assert.equal(result.exitCode, 99);
  assert.ok(stderr.length > 0);
  assert.equal(volume.existsSync("/missing"), false);
});

it("Pdfdetach reads only input operands", async () => {
  const { result, reads, stderr } = await execute(createPdfdetachCommand(), ["-saveall", "-o", "out", "in.pdf"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual([...new Set(reads)], ["/work/in.pdf"]);
});

it("Pdfdetach reports missing output parents without creating directories", async () => {
  const { result, volume, stderr } = await execute(createPdfdetachCommand(), ["-saveall", "-o", "/missing/out", "in.pdf"], true);
  assert.equal(result.exitCode, 2);
  assert.ok(stderr.length > 0);
  assert.equal(volume.existsSync("/missing"), false);
});

for (const name of ["../escaped.txt", "/escaped.txt", "nested/payload.txt", "nested\\payload.txt"]) {
  it(`contains attachment ${name} in the chosen directory`, async () => {
    const { result, volume, stderr } = await execute(createPdfdetachCommand(), ["-saveall", "-o", "/work", "in.pdf"], false, name);
    assert.equal(result.exitCode, 0, stderr);
    const basename = name.split("/").at(-1)!.split("\\").at(-1)!;
    assert.equal(volume.readFileSync(`/work/${basename}`, "utf8"), "payload");
    assert.equal(volume.existsSync("/escaped.txt"), false);
  });
}

it("pdfinfo ignores filenames matching option values", async () => {
  const { result, reads, stderr } = await execute(createPdfinfoCommand(), ["-f", "1", "in.pdf"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(reads, ["/work/in.pdf"]);
});

for (const args of [["-save", "1"], ["-savefile", "../escaped.txt"], ["-save", "1", "-o", "/work/"]]) {
  it(`contains a single attachment: ${args.join(" ")}`, async () => {
    const { result, volume, stderr } = await execute(createPdfdetachCommand(), [...args, "in.pdf"], false, "../escaped.txt");
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(volume.readFileSync("/work/escaped.txt", "utf8"), "payload");
    assert.equal(volume.existsSync("/escaped.txt"), false);
  });
}
it("respects an explicit attachment output filename", async () => {
  const { result, volume, stderr } = await execute(createPdfdetachCommand(), ["-save", "1", "-o", "/work/chosen.txt", "in.pdf"], false, "../escaped.txt");
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(volume.readFileSync("/work/chosen.txt", "utf8"), "payload");
});

it("normalizes dot segments before VFS access", async () => {
  const { result, reads, stderr } = await execute(createPdfinfoCommand(), ["missing/../in.pdf"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(reads, ["/work/in.pdf"]);
});

it("stages dash-prefixed operands after --", async () => {
  const { result, reads, stderr } = await execute(createPdfinfoCommand(), ["--", "-in.pdf"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(reads, ["/work/-in.pdf"]);
});

for (const args of [["-save", "1"], ["-savefile", "../escaped.txt"]]) {
  it(`extracts to an existing directory without a trailing slash: ${args.join(" ")}`, async () => {
    const { result, volume, stderr } = await execute(createPdfdetachCommand(), [...args, "-o", "out", "in.pdf"], false, "../escaped.txt");
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(volume.readFileSync("/work/out/escaped.txt", "utf8"), "payload");
  });
}
