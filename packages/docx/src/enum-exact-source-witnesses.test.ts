import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { enumSourceCases, enumSourceOperations } from "../tests/fixtures/enum-exact-source.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
const enc = (s: string) => new TextEncoder().encode(s);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const c of enumSourceCases) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} independently executes exact typed enum witness R${c.row}; ${kind}; strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p><!--retained--><?policy keep?>', {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const v = Volume.fromJSON({ "/input": "", "/out": "" }); await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { v.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(v.readFileSync("/input") as Buffer), operations = enumSourceOperations(c), rejects = ["class-reject", "invalid-number", "invalid-xml"].includes(c.action), sink = { async write(bytes: Uint8Array) { v.appendFileSync("/out", bytes); } };
  const observe = (values: unknown[]) => { if (c.action === "equality") { expect([values[1], values[3]]).toEqual(c.expected); expect(values[1]).not.toBe(values[3]); } else if ("expected" in c) expect(values.at(-1)).toEqual(c.expected); };
  if (route === "model") {
    const family = api.WD_PARAGRAPH_ALIGNMENT, symbol = family.CENTER;
    expect(Object.isFrozen(family)).toBe(true); expect(Object.isFrozen(symbol)).toBe(true); expect(api.enumFromValue("WD_PARAGRAPH_ALIGNMENT", 1)).toBe(symbol);
    if (c.action === "class-reject") { expect(Object.hasOwn(api, "BaseXmlEnum")).toBe(false); expect(() => api.enumMembers("SomeXmlAttr" as Parameters<typeof api.enumMembers>[0])).toThrowError(expect.objectContaining({ code: "usage" })); }
    else if (c.action === "invalid-number") expect(() => family.to_xml(42)).toThrow(api.InvalidValueError);
    else if (c.action === "invalid-xml") expect(() => family.from_xml("baz")).toThrow(api.InvalidValueError);
    else if (c.action === "to-symbol") expect(family.to_xml(symbol)).toBe(c.expected);
    else if (c.action === "to-number") expect(family.to_xml(2)).toBe(c.expected);
    else if (c.action === "from-xml") expect(family.from_xml("right")).toBe(family.RIGHT);
    else if (c.action === "from-null") expect(api.WD_UNDERLINE.from_xml(null)).toBe(api.WD_UNDERLINE.INHERITED);
    else if (c.action === "typed-member") expect({ enum: symbol.enum, name: symbol.name }).toEqual(c.expected);
    else if (c.action === "string-center" || c.action === "string-right") expect((c.action === "string-center" ? symbol : family.RIGHT).toString()).toBe(c.expected);
    else if (c.action === "value") expect(symbol.value).toBe(c.expected);
    else if (c.action === "name") expect(symbol.name).toBe(c.expected);
    else { expect([symbol.value, family.RIGHT.value]).toEqual(c.expected); expect(symbol.value).not.toBe(2); expect(family.RIGHT.value).not.toBe(1); expect(() => Number(symbol)).toThrow(api.InputTypeError); }
    expect(() => api.enumMembers("SomeXmlAttr" as Parameters<typeof api.enumMembers>[0])).toThrowError(expect.objectContaining({ code: "usage" }));
    await (await api.Document(input, textContext)).save(sink);
  } else if (route === "sdk") { await expect(api.applyStyleModelBatch(input, { version: 1, operations: [{ operation: "model.enum.base.SomeXmlAttr.FOO.get", arguments: {} }] }, textContext)).rejects.toMatchObject({ code: "usage" }); if (rejects) await expect(api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).rejects.toMatchObject({ code: "usage" }); else { const r = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); expect(r.affected).toBe(0); observe(r.results.map(i => i.value)); await r.save(sink); } }
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", enc("retained destination")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations }))); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const r = await shell.exec("docx batch /input --ops-file /ops --json"); expect(r.exitCode, r.stdout + r.stderr).toBe(rejects ? 2 : 0); const e = JSON.parse(r.stdout); expect(e.affected).toBe(0); if (rejects) expect(e.errors[0].code).toBe("usage"); else { expect(e.data.publication).toBeNull(); observe(e.data.results.map((i: { data: unknown }) => i.data)); } await fs.writeFile("/originalOps", enc(JSON.stringify({ version: 1, operations: [{ operation: "model.enum.base.SomeXmlAttr.FOO.get", arguments: {} }] }))); const original = await shell.exec("docx batch /input --ops-file /originalOps --json"); expect(original.exitCode, original.stdout + original.stderr).toBe(2); expect(JSON.parse(original.stdout)).toMatchObject({ affected: 0, data: null, errors: [{ code: "usage" }] }); expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/destination")).toEqual(enc("retained destination")); } finally { await shell.dispose(); } }
  if (route === "model" || route === "sdk" && !rejects) { const saved = readPackage(new Uint8Array(v.readFileSync("/out") as Buffer)); assertPackageLinks(saved); expect(saved).toEqual(parts); } else expect(v.readFileSync("/out")).toHaveLength(0);
  expect(v.readFileSync("/input")).toEqual(Buffer.from(input));
});
