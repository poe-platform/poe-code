// Output failure statuses: qpdf 12.4.2, pdftk-java 3.3.3, Poppler 26.09.0.
import { it, assert, expect } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosDict, cosName, cosString, cosStream, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createPdftkCommand } from "./index.js";

function fixture(name = "payload.txt") {
  const doc = PdfDocument.create();
  const page = doc.addPage([8, 8]);
  page.drawImage(doc.embedRgbImage(1, 1, new Uint8Array([255, 0, 0])), { x: 0, y: 0, width: 8, height: 8 });
  const stream = doc.cos.allocateObject(cosStream(cosDict({ Type: cosName("EmbeddedFile") }), new TextEncoder().encode("payload")));
  const spec = doc.cos.allocateObject(cosDict({ Type: cosName("Filespec"), F: cosString(name), UF: cosString(name), EF: cosDict({ F: stream }) }));
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "Names", cosDict({ EmbeddedFiles: cosDict({ Names: cosArray([cosString(name), spec]) }) }));
  return doc.save();
}

async function execute(command: ReturnType<typeof createPdftkCommand>, args: string[], attachment = "payload.txt") {
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
    fs: new Proxy(fs, { get(owner, key) {
      if (key === "readFile") return async (...args: Parameters<typeof fs.readFile>) => { reads.push(args[0]); return fs.readFile(...args); };
      if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof fs.openReadFile>>) => { reads.push(args[0]); return fs.openReadFile!(...args); };
      const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
    } })
  } as unknown as CommandContext;
  const result = await command.execute(context);
  return { result, reads, fs, stderr: errors.map(bytes => new TextDecoder().decode(bytes)).join("") };
}

it("Pdftk reads only input operands", async () => {
  const { result, reads, stderr } = await execute(createPdftkCommand(), ["in.pdf", "cat", "1", "output", "out.pdf"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual([...new Set(reads)], ["/work/in.pdf"]);
});

it("Pdftk reports missing output parents without creating directories", async () => {
  const { result, fs, stderr } = await execute(createPdftkCommand(), ["in.pdf", "cat", "1", "output", "/missing/out.pdf"]);
  assert.equal(result.exitCode, 1);
  assert.ok(stderr.length > 0);
  await expect(fs.stat("/missing")).rejects.toMatchObject({ code: "ENOENT" });
});

for (const name of ["../escaped.txt", "/escaped.txt", "nested/payload.txt", "nested\\payload.txt"]) {
  it(`contains attachment ${name} in the chosen directory`, async () => {
    const { result, fs, stderr } = await execute(createPdftkCommand(), ["in.pdf", "unpack_files", "output", "/work"], name);
    assert.equal(result.exitCode, 0, stderr);
    const basename = name.split("/").at(-1)!.split("\\").at(-1)!;
    assert.equal(new TextDecoder().decode(await fs.readFile(`/work/${basename}`)), "payload");
    await expect(fs.stat("/escaped.txt")).rejects.toMatchObject({ code: "ENOENT" });
  });
}

for (const args of [["A=in.pdf", "input_pw", "secret", "cat", "A1", "output", "out.pdf"], ["in.pdf", "background", "in.pdf", "output", "out.pdf"], ["in.pdf", "attach_files", "in.pdf", "to_page", "1", "output", "out.pdf"]]) {
  it(`reads pdftk input operands: ${args.join(" ")}`, async () => {
    const { result, reads, stderr } = await execute(createPdftkCommand(), args);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(reads, ["/work/in.pdf"]);
  });
}

it("normalizes dot segments before VFS access", async () => {
  const { result, reads, stderr } = await execute(createPdftkCommand(), ["missing/../in.pdf", "cat", "missing/../output", "missing/../out.pdf"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(reads, ["/work/in.pdf"]);
});
