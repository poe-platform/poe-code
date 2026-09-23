import {Volume} from "memfs";
import {expect, it} from "vitest";
import {MemoryFileSystem, Shell} from "@poe-platform/safe-bash";
import {docxCommands} from "@poe-platform/safe-bash/commands/docx";
import {Document, createDocxInspectionCommandEngine, inspectDocument, readArchive, writeArchive} from "./index.js";
import {textContext, textFixture} from "../tests/fixtures/text.js";
import {zip64Document} from "../tests/fixtures/zip64-members.js";
import {readPackage} from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
const context = {...textContext, limits: {...textContext.limits, maxArchiveBytes: 400000, maxExtraBytes: 65535, maxCommentBytes: 65535, maxPathBytes: 65535}};
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const compression of ["store", "deflate"] as const) for (const wide of [false, true])
for (const headerBytes of [65534, 65535, 65536, 65540]) for (const route of ["archive", "model", "sdk", "shell"])
it(`${route} enforces OPC central header ${headerBytes} bytes; ${kind} strict=${strict} ${compression} ZIP${wide ? 64 : 32}`, async () => {
  const memory = Volume.fromJSON({"/baseline": "", "/output": ""});
  let baseline: Uint8Array, parts: Map<string, Uint8Array>;
  if (wide) {const fixture = zip64Document({strict, kind, compression, fields: "both", descriptor: "signed"}); baseline = fixture.input; parts = fixture.parts;}
  else {
    parts = readPackage(await textFixture('<w:p><w:r><w:t>Wide member</w:t></w:r></w:p>', {}, strict));
    if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
    await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/baseline", bytes);}}, {order: "input", compression}, context);
    baseline = new Uint8Array(memory.readFileSync("/baseline") as Buffer);
  }
  const old = new DataView(baseline.buffer, baseline.byteOffset, baseline.byteLength), end = baseline.length - (wide ? 98 : 22);
  const central = wide ? Number(old.getBigUint64(end + 48, true)) : old.getUint32(end + 16, true);
  const fixed = 46 + old.getUint16(central + 28, true) + old.getUint16(central + 30, true), commentBytes = headerBytes - fixed, insert = central + fixed;
  const input = new Uint8Array(baseline.length + commentBytes); input.set(baseline.subarray(0, insert)); input.fill(99, insert, insert + commentBytes); input.set(baseline.subarray(insert), insert + commentBytes);
  const view = new DataView(input.buffer); view.setUint16(central + 32, commentBytes, true);
  if (wide) {view.setBigUint64(end + commentBytes + 40, old.getBigUint64(end + 40, true) + BigInt(commentBytes), true); view.setBigUint64(end + commentBytes + 64, BigInt(end + commentBytes), true);}
  else view.setUint32(end + commentBytes + 12, old.getUint32(end + 12, true) + commentBytes, true);
  const admitted = headerBytes <= 65535, before = input.slice();
  if (route === "shell") {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/sentinel", enc("retain"));
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: context.limits})})).exec("docx inspect /input --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(admitted ? 0 : 1);
    if (!admitted) expect(JSON.parse(result.stdout)).toMatchObject({ok: false, data: null, affected: 0, errors: [{code: "invalid-container"}]});
    else expect(JSON.parse(result.stdout).data).toMatchObject({kind, dialect: strict ? "strict" : "transitional"});
    expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/sentinel")).toEqual(enc("retain"));
  } else {
    const pending = route === "archive" ? readArchive(input, context) : route === "model" ? Document(input, context) : inspectDocument(input, context);
    if (!admitted) await expect(pending).rejects.toMatchObject({code: "invalid-container"});
    else {
      const value = await pending;
      if ("members" in value) expect(new Map(value.members.map(member => [member.name, member.bytes]))).toEqual(parts);
      else if ("paragraphs" in value) {expect(value.paragraphs[0]!.text).toBe("Wide member"); await value.save({async write(bytes) {memory.appendFileSync("/output", bytes);}}); expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(parts);}
      else expect(value).toMatchObject({kind, dialect: strict ? "strict" : "transitional"});
    }
  }
  expect(input).toEqual(before);
});

for (const nameBytes of [65488, 65489, 65490]) for (const compression of ["store", "deflate"] as const)
it(`archive writer enforces OPC central header for ${nameBytes} name bytes; ${compression}`, async () => {
  const name = "a".repeat(nameBytes), memory = Volume.fromJSON({"/output": ""});
  const pending = writeArchive({comment: new Uint8Array(), members: [{name, bytes: enc("original"), directory: false, modified: new Date("2026-01-02T03:04:06Z")}]}, {async write(bytes) {memory.appendFileSync("/output", bytes);}}, {order: "input", compression}, context);
  if (nameBytes + 46 > 65535) {await expect(pending).rejects.toMatchObject({code: "invalid-container"}); expect(memory.readFileSync("/output")).toHaveLength(0);}
  else {await pending; expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(new Map([[name, enc("original")]]));}
});
