import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const cp = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const encode = (value: string) => new TextEncoder().encode(value);

async function fixture(strict: boolean, kind: "docx" | "dotx", revision: string) {
  const doc = await api.Document(await textFixture("<w:p><w:r><w:t>Unrelated coast</w:t></w:r></w:p>", {}, strict, { kind }), { ...textContext, timestamp: new Date("2026-03-04T05:06:07Z") });
  doc.core_properties.revision = 1;
  const memory = Volume.fromJSON({ "/input": "", "/seed": "" });
  await doc.save({ async write(bytes) { memory.appendFileSync("/seed", bytes); } });
  const archive = await api.readArchive(new Uint8Array(memory.readFileSync("/seed") as Buffer), textContext);
  const member = archive.members.find(item => item.name === doc.core_properties.part.partname.toString().slice(1))!;
  const xml = new api.DocumentXmlEditor(encode(`<cp:coreProperties xmlns:cp="${cp}" xmlns:dc="http://purl.org/dc/elements/1.1/"><cp:revision>1</cp:revision><dc:title>Retained 海 🌊</dc:title><!--retain--><?audit exact?></cp:coreProperties>`));
  const stored = xml.root.children.find(node => node.namespace === cp && node.localName === "revision")!;
  xml.replaceScalarText(stored, revision);
  await api.writeArchive({ ...archive, members: archive.members.map(item => item === member ? { ...item, bytes: xml.serialize() } : item) },
    { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(memory.readFileSync("/input") as Buffer);
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const lexical of ["0", "000", "+0"])
for (const route of ["model", "sdk", "cli"] as const)
  it(`stored revision zero reads and accepts positive replacement; ${route}; ${lexical}; ${kind}; strict=${strict}`, async () => {
    const input = await fixture(strict, kind, lexical);
    const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
    const before = readPackage(input);
    if (route === "model") {
      const doc = await api.Document(input, textContext);
      expect(doc.core_properties.revision).toBe(0);
      expect(() => { doc.core_properties.revision = 0; }).toThrow();
      doc.core_properties.revision = 2;
      await doc.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
    } else if (route === "sdk") {
      const data = await api.inspectDocumentProperties(input, { name: "core:revision" }, textContext);
      expect(data.warnings).toEqual([]);
      expect(data.items[0]).toMatchObject({ support: "edit", properties: [{ name: "revision", type: "integer", value: 0, writable: true, cached: false }] });
      await expect(api.editDocumentProperties(input, { operation: "properties.set", name: "core:revision", value: 0, dryRun: true }, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({ code: "usage" });
      await api.editDocumentProperties(input, { operation: "properties.set", name: "core:revision", value: 2, output: "-" },
        { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    } else {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input", input);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const read = await shell.exec("docx properties get /input --name core:revision --json");
        expect(read.exitCode, read.stdout + read.stderr).toBe(0);
        expect(JSON.parse(read.stdout)).toMatchObject({ ok: true, warnings: [], data: { item: { properties: [{ value: 0, writable: true }] } } });
        const invalid = await shell.exec("docx properties set /input --name core:revision --value 0 --output /output --json");
        expect(invalid.exitCode, invalid.stdout + invalid.stderr).toBe(2);
        await expect(fs.readFile("/output")).rejects.toThrow();
        const edited = await shell.exec("docx properties set /input --name core:revision --value 2 --output /output --json");
        expect(edited.exitCode, edited.stdout + edited.stderr).toBe(0);
        memory.writeFileSync("/output", await fs.readFile("/output"));
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer);
    expect((await api.inspectDocumentProperties(output, { name: "core:revision" }, textContext)).items[0]?.properties[0]?.value).toBe(2);
    const after = readPackage(output), core = (await api.Document(output, textContext)).core_properties.part.partname.toString().slice(1);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [name, bytes] of before) if (name !== core) expect(after.get(name), name).toEqual(bytes);
    expect(new TextDecoder().decode(after.get(core))).toContain('Retained 海 🌊</dc:title><!--retain--><?audit exact?>');
    expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  });
