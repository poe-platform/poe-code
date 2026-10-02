import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, inspectDocument, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
function withZip64End(input: Uint8Array) {
  const end = input.length - 22, old = new DataView(input.buffer, input.byteOffset, input.byteLength), output = new Uint8Array(input.length + 76), view = new DataView(output.buffer);
  output.set(input.subarray(0, end)); output.set(input.subarray(end), end + 76);
  view.setUint32(end, 0x06064b50, true); view.setBigUint64(end + 4, 44n, true); view.setUint16(end + 12, 45, true); view.setUint16(end + 14, 45, true);
  view.setBigUint64(end + 24, BigInt(old.getUint16(end + 8, true)), true); view.setBigUint64(end + 32, BigInt(old.getUint16(end + 10, true)), true); view.setBigUint64(end + 40, BigInt(old.getUint32(end + 12, true)), true); view.setBigUint64(end + 48, BigInt(old.getUint32(end + 16, true)), true);
  view.setUint32(end + 56, 0x07064b50, true); view.setBigUint64(end + 64, BigInt(end), true); view.setUint32(end + 72, 1, true); view.setUint16(end + 84, 65535, true); view.setUint16(end + 86, 65535, true); view.setUint32(end + 88, 0xffffffff, true); view.setUint32(end + 92, 0xffffffff, true);
  return output;
}
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const compression of ["store", "deflate"] as const) for (const extended of [false, true])
for (const duplicate of ["_rels/.rels", "audit/a.xml"]) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} rejects duplicate ${duplicate}; ${kind} strict=${strict} ${compression} ZIP${extended ? 64 : 32}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>', {}, strict));
  parts.set("audit/a.xml", encode("<audit>First</audit>")); parts.set("audit/b.xml", encode("<audit>Second</audit>"));
  parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("</Types>", '<Default Extension="xml" ContentType="application/xml"/></Types>').replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression}, textContext);
  const zipped = new Uint8Array(memory.readFileSync("/input") as Buffer), valid = extended ? withZip64End(zipped) : zipped, input = valid.slice(), view = new DataView(input.buffer);
  let at = new DataView(zipped.buffer).getUint32(zipped.length - 6, true), changed = false;
  for (let member = 0; member < parts.size; member++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
    if (decode(input.subarray(at + 46, at + 46 + nameLength)) === "audit/b.xml") {
      const local = view.getUint32(at + 42, true); expect(view.getUint32(local, true)).toBe(0x04034b50); expect(nameLength).toBe(duplicate.length);
      input.set(encode(duplicate), at + 46); input.set(encode(duplicate), local + 30); changed = true;
    }
    at += 46 + nameLength + extra + comment;
  }
  expect(changed).toBe(true); const retained = input.slice();
  if (route === "model") {expect((await Document(valid, textContext)).paragraphs[0]!.text).toBe("Original coast"); await expect(Document(input, textContext)).rejects.toMatchObject({code: "invalid-container"});}
  else if (route === "sdk") {expect((await inspectDocument(valid, textContext)).kind).toBe(kind); await expect(inspectDocument(input, textContext)).rejects.toMatchObject({code: "invalid-container"});}
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/valid", valid); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const control = await shell.exec("docx inspect /valid --json"); expect(control.exitCode, control.stderr).toBe(0);
    const result = await shell.exec("docx inspect /input --json"); expect(result.exitCode).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ok: false, data: null, affected: 0, locations: [], errors: [expect.objectContaining({code: "invalid-container"})]});
    expect(await fs.readFile("/input")).toEqual(retained); expect(await fs.readFile("/valid")).toEqual(valid);
  }
  expect(input).toEqual(retained); expect(memory.readFileSync("/input")).toEqual(Buffer.from(zipped));
});
