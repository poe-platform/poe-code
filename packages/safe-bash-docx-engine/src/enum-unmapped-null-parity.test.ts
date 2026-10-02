import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const cases = [
  ["dml", "MSO_COLOR_TYPE", "RGB"], ["style", "WD_BUILTIN_STYLE", "NORMAL"],
  ["text", "WD_BREAK_TYPE", "PAGE"], ["shape", "WD_INLINE_SHAPE_TYPE", "PICTURE"],
  ["table", "WD_TABLE_DIRECTION", "LTR"]
] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const [group, family, member] of cases) for (const route of ["sdk", "shell"] as const)
it(`${route} rejects undeclared numeric-only XML route before conversion for ${family}; ${kind} strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Original enum boundary 日本 é 🌊 עברית</w:t></w:r></w:p>', {}, strict));
  if (kind === "dotx") {
    const xml = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!), main = xml.root.children.find(n => n.attributes.some(a => a.localName === "PartName" && a.value === "/word/document.xml"))!;
    xml.setAttribute(main, { namespace: "", localName: "ContentType" }, "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"); parts.set("[Content_Types].xml", xml.serialize());
  }
  const volume = Volume.fromJSON({ "/input": "", "/out": "" }); await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(b) { volume.appendFileSync("/input", b); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), original = new Uint8Array(input), base = `model.enum.${group}.${family}`, batch = { version: 1 as const, operations: [{ operation: `${base}.${member}.get`, arguments: {}, resultHandle: "symbol" }, { operation: `${base}.to_xml.call`, receiver: { resultHandle: "symbol" }, arguments: { value: null } }] };
  expect(() => api[family].to_xml(null)).toThrowError(expect.objectContaining({ code: "usage" }));
  expect(() => api.validateDocxBatch(batch)).toThrow("Unknown document operation.");
  if (route === "sdk") await expect(api.applyStyleModelBatch(input, batch, textContext)).rejects.toMatchObject({ code: "usage", message: "Unknown document operation." });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(batch)}' --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(2); const envelope = JSON.parse(result.stdout); expect(envelope.errors[0]).toMatchObject({ code: "usage", message: "Unknown document operation." }); expect(await fs.readFile("/input")).toEqual(original); } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original); expect(volume.readFileSync("/out").length).toBe(0);
});
