// Output failure statuses: qpdf 12.4.2, pdftk-java 3.3.3, Poppler 26.09.0.
import assert from "node:assert/strict";
import { it } from "vitest";
import { Volume } from "memfs";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosDict, cosName, cosString, cosStream, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createPdfimagesCommand } from "./index.js";

function fixture(name = "payload.txt") {
  const doc = PdfDocument.create();
  const page = doc.addPage([8, 8]);
  page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([255, 0, 0])), { x: 0, y: 0, width: 8, height: 8 });
  const stream = doc.cos.allocateObject(cosStream(cosDict({ Type: cosName("EmbeddedFile") }), new TextEncoder().encode("payload")));
  const spec = doc.cos.allocateObject(cosDict({ Type: cosName("Filespec"), F: cosString(name), UF: cosString(name), EF: cosDict({ F: stream }) }));
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "Names", cosDict({ EmbeddedFiles: cosDict({ Names: cosArray([cosString(name), spec]) }) }));
  return doc.save();
}

async function execute(command: ReturnType<typeof createPdfimagesCommand>, args: string[], _missing = false, attachment = "payload.txt") {
  const volume = new Volume();
  volume.mkdirSync("/work");
  volume.writeFileSync("/work/in.pdf", fixture(attachment));
  volume.writeFileSync("/work/-in.pdf", fixture(attachment));
  for (const name of ["out.pdf", "out.html", "out", "out-%d.pdf", "cat", "1", "output"]) volume.writeFileSync(`/work/${name}`, new Uint8Array(10000));
  const reads: string[] = [], errors: Uint8Array[] = [];
  const carrier = createCommandArguments(args);
  const fs = createMemoryFileSystem(); await fs.mkdir("/work"); await fs.mkdir("/tmp");
  for (const name of volume.readdirSync("/work") as string[]) await fs.writeFile(`/work/${name}`, new Uint8Array(volume.readFileSync(`/work/${name}`) as Buffer));
  const context = {
    command: command.name, args: carrier.args, argumentValues: carrier, cwd: "/work", env: {},
    signal: new AbortController().signal, registerCleanup() {}, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } },
    fs: new Proxy(fs, { get(target, key) {
      if (key === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => {
        if (!args[0].startsWith("/tmp/") && !args[0].includes("/.pdf-")) reads.push(args[0]);
        return target.openReadFile(...args);
      };
      if (key === "readFile") return async () => { throw new Error("whole read forbidden"); };
      const value = Reflect.get(target,key,target); return typeof value === "function" ? value.bind(target) : value;
    } })
  } as CommandContext;
  const result = await command.execute(context);
  for (const entry of await fs.readdir("/work")) if (entry.type === "file") volume.writeFileSync(`/work/${entry.name}`, await fs.readFile(`/work/${entry.name}`));
  return { result, reads, volume, stderr: Buffer.concat(errors).toString() };
}

it("Pdfimages reads only input operands", async () => {
  const { result, reads, stderr } = await execute(createPdfimagesCommand(), ["in.pdf", "out"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual([...new Set(reads)], ["/work/in.pdf"]);
});

it("Pdfimages reports missing output parents without creating directories", async () => {
  const { result, volume, stderr } = await execute(createPdfimagesCommand(), ["in.pdf", "/missing/img"], true);
  assert.equal(result.exitCode, 2);
  assert.ok(stderr.includes("Couldn't open image file"));
  assert.equal(volume.existsSync("/missing"), false);
});

for (const args of [["-list", "-"], ["-", "out"]]) {
  it(`reports empty stdin for pdfimages ${args.join(" ")}`, async () => {
    const { result, stderr } = await execute(createPdfimagesCommand(), args);
    assert.equal(result.exitCode, 1);
    assert.ok(stderr.includes("Syntax Error: Document stream is empty"), stderr);
  });
}

it("normalizes dot segments before VFS access", async () => {
  const { result, reads, stderr } = await execute(createPdfimagesCommand(), ["missing/../in.pdf", "missing/../out"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(reads, ["/work/in.pdf"]);
});

it("stages dash-prefixed operands after --", async () => {
  const { result, reads, stderr } = await execute(createPdfimagesCommand(), ["--", "-in.pdf", "out"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(reads, ["/work/-in.pdf"]);
});
