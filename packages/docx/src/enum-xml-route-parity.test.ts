import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import facts from "../tests/fixtures/enum-xml.json" with { type: "json" };
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage } from "../tests/assertions.js";

interface Member { readonly enum: string; readonly name: string; readonly value: number; readonly xml_value?: string | null }
interface Family { readonly [key: string]: unknown; from_xml(value: string | null): Member; to_xml(value: Member | number | null): string | null }
interface Operation { operation: string; arguments: Record<string, unknown>; receiver?: { resultHandle: string }; resultHandle?: string }
const exported = api as unknown as Record<string, Family>;

async function fixture(strict: boolean, kind: "docx" | "dotx") {
  const input = await textFixture('<w:p><w:r><w:t>Enum 日本 é 🌊 עברית</w:t></w:r></w:p>', {}, strict);
  const parts = readPackage(input);
  if (kind === "dotx") {
    const editor = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!);
    const main = editor.root.children.find(n => n.attributes.some(a => a.localName === "PartName" && a.value === "/word/document.xml"))!;
    editor.setAttribute(main, { namespace: "", localName: "ContentType" }, "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml");
    parts.set("[Content_Types].xml", editor.serialize());
  }
  const volume = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  return { volume, parts, input: new Uint8Array(volume.readFileSync("/input") as Buffer) };
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const family of facts.families) for (const route of ["model", "sdk", "shell"] as const) {
  const base = `model.enum.${family.group}.${family.routeFamily}`;
  it(`${route} converts every mapped ${family.family} member and null without dirtying ${kind}; strict=${strict}`, async () => {
    const f = await fixture(strict, kind), original = new Uint8Array(f.input), operations: Operation[] = [], expected: unknown[] = [];
    const value = exported[family.family]!;
    for (const entry of family.entries) {
      const member = value[entry.name] as Member, handle = entry.name;
      if (route === "model") expect(member.xml_value).toBe(entry.xml);
      operations.push({ operation: `${base}.${entry.name}.get`, arguments: {}, resultHandle: handle }); expected.push({ enum: family.family, name: entry.name });
      operations.push({ operation: `${base}.xml_value.get`, receiver: { resultHandle: handle }, arguments: {} }); expected.push(entry.xml);
      if (!entry.mapped) continue;
      if (route === "model") {
        expect(value.to_xml(member)).toBe(entry.xml); expect(value.to_xml(entry.value)).toBe(entry.xml);
        expect(value.from_xml(entry.xml)).toBe(member);
      }
      for (const supplied of [entry.value, { enum: family.family, name: entry.name }]) {
        operations.push({ operation: `${base}.to_xml.call`, receiver: { resultHandle: handle }, arguments: { value: supplied } }); expected.push(entry.xml);
      }
      operations.push({ operation: `${base}.from_xml.call`, arguments: { xmlValue: entry.xml } }); expected.push({ enum: family.family, name: entry.name });
    }
    const first = family.entries[0]!;
    operations.push({ operation: `${base}.to_xml.call`, receiver: { resultHandle: first.name }, arguments: { value: null } }); expected.push(null);
    if (route === "model") {
      expect(value.to_xml(null)).toBeNull();
      const doc = await api.Document(f.input, textContext);
      await doc.save({ async write(bytes) { f.volume.appendFileSync("/out", bytes); } });
    } else if (route === "sdk") {
      const result = await api.applyStyleModelBatch(f.input, { version: 1, operations }, textContext);
      expect(result.affected).toBe(0); expect(result.results.map(r => r.value)).toEqual(expected);
      await result.save({ async write(bytes) { f.volume.appendFileSync("/out", bytes); } });
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", f.input);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --json`);
        expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(result.stderr).toBe("");
        const envelope = JSON.parse(result.stdout);
        expect(envelope).toMatchObject({ ok: true, affected: 0, errors: [], data: { publication: null } });
        expect(envelope.data.results.map((r: { data: unknown }) => r.data)).toEqual(expected);
        expect(await fs.readFile("/input")).toEqual(original);
      } finally { await shell.dispose(); }
    }
    if (route !== "shell") { const output = readPackage(new Uint8Array(f.volume.readFileSync("/out") as Buffer)); assertPackageLinks(output); expect(output).toEqual(f.parts); }
    expect(f.input).toEqual(original); expect(new Uint8Array(f.volume.readFileSync("/input") as Buffer)).toEqual(original);
  });

  it(`${route} rejects unmapped and invalid ${family.family} XML conversions without publication; ${kind} strict=${strict}`, async () => {
    const f = await fixture(strict, kind), value = exported[family.family]!, first = family.entries[0]!, bootstrap: Operation = { operation: `${base}.${first.name}.get`, arguments: {}, resultHandle: "symbol" };
    const bad: Operation[] = [];
    for (const xmlValue of ["UNMAPPED", "unknown", "", "LEFT", 0, false, ...(family.entries.some(e => e.mapped && e.xml === null) ? [] : [null])]) bad.push({ operation: `${base}.from_xml.call`, arguments: { xmlValue } });
    for (const supplied of [99999, 0.5, "0", false, { enum: family.family === "WD_UNDERLINE" ? "WD_COLOR_INDEX" : "WD_UNDERLINE", name: "NONE" }, ...family.entries.filter(e => !e.mapped).flatMap(e => [e.value, { enum: family.family, name: e.name }])]) bad.push({ operation: `${base}.to_xml.call`, receiver: { resultHandle: "symbol" }, arguments: { value: supplied } });
    if (route === "model") {
      for (const item of bad) {
        const invoke = () => item.operation.endsWith("from_xml.call") ? value.from_xml(item.arguments.xmlValue as string | null) : value.to_xml(item.arguments.value as Member | number);
        expect(invoke).toThrowError(expect.objectContaining({ code: "usage" }));
      }
      const doc = await api.Document(f.input, textContext); await doc.save({ async write(bytes) { f.volume.appendFileSync("/out", bytes); } });
      expect(readPackage(new Uint8Array(f.volume.readFileSync("/out") as Buffer))).toEqual(f.parts);
    } else if (route === "sdk") {
      for (const item of bad) await expect(api.applyStyleModelBatch(f.input, { version: 1, operations: [bootstrap, item] }, textContext)).rejects.toMatchObject({ code: "usage" });
      expect(f.volume.readFileSync("/out").length).toBe(0);
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", f.input); await fs.writeFile("/out", new TextEncoder().encode("retained destination"));
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        for (const item of bad) {
          const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations: [bootstrap, item] })}' --output /out --force --json`);
          expect(result.exitCode, result.stdout + result.stderr).toBe(2); expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, errors: [{ code: "usage" }] });
          expect(await fs.readFile("/input")).toEqual(f.input); expect(await fs.readFile("/out")).toEqual(new TextEncoder().encode("retained destination"));
        }
      } finally { await shell.dispose(); }
    }
    expect(new Uint8Array(f.volume.readFileSync("/input") as Buffer)).toEqual(f.input);
  });
}
