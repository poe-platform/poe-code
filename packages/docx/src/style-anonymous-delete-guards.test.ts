import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const canary of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} deletes anonymous ${carrier} style or refuses foreign-owner loss; strict=${strict}; canary=${canary}`, async () => {
  const active = `<w:style${canary ? ' f:canary="original"' : ""}/>`;
  const wrap = carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque f:identity="retained"/>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}"${carrier === "fallback" ? ' f:identity="retained"' : ""}>${carrier === "choice" ? active : ""}</mc:Choice><mc:Fallback${carrier === "choice" ? ' f:identity="retained"' : ""}>${carrier === "fallback" ? active : ""}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture('<w:p><w:r><w:t>Original 日本 עברית 🌊</w:t></w:r></w:p>', {styles: {kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:style-delete" mc:Ignorable="f" mc:ProcessContent="f:pass">${wrap}<!--retain--><?audit keep?></w:styles>`}}, strict), memory = Volume.fromJSON({"/out": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/out", bytes);}}, operations = [
    {operation: "model.document.Document.styles.get", receiver: {resultHandle: "document"}, arguments: {}, resultHandle: "styles"},
    {operation: "model.styles.styles.Styles.__iter__.call", receiver: {resultHandle: "styles"}, arguments: {}, resultHandle: "items"},
    {operation: "model.styles.style.BaseStyle.delete.call", receiver: {resultHandle: "items", index: 0}, arguments: {}}
  ];
  if (route === "model") {const doc = await api.Document(input, textContext), selected = [...doc.styles][0]!; if (canary) {expect(() => selected.delete()).toThrow(api.UnsupportedEditError); expect([...doc.styles]).toHaveLength(1);} else {selected.delete(); expect(() => selected.element).toThrow(api.StaleHandleError);} await doc.save(sink);}
  else if (route === "sdk") {if (canary) {await expect(api.applyStyleModelBatch(input, {version: 1, operations}, textContext)).rejects.toMatchObject({code: "unsupported-edit"}); expect(memory.readFileSync("/out")).toHaveLength(0);} else await (await api.applyStyleModelBatch(input, {version: 1, operations}, textContext)).save(sink);}
  else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("Original destination")); const shell = new Shell({fs}).use(docxCommands({engine: api.createDocxInspectionCommandEngine({limits: textContext.limits})})); try {const r = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({version: 1, operations})}' --json --output /out --force`); expect(r.exitCode, r.stdout + r.stderr).toBe(canary ? 1 : 0); if (canary) {expect(JSON.parse(r.stdout).errors[0].code).toBe("unsupported-edit"); expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");} else memory.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input);} finally {await shell.dispose();}}
  if (canary) {if (route === "model") expect(new Uint8Array(memory.readFileSync("/out") as Buffer)).toEqual(input); return;}
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after);
  for (const [name, bytes] of before) if (name !== "word/styles.xml") expect(after.get(name), name).toEqual(bytes);
  const doc = await api.Document(output, textContext); expect([...doc.styles]).toHaveLength(0); expect(doc.paragraphs[0]!.text).toBe("Original 日本 עברית 🌊");
  const saved = new TextDecoder().decode(after.get("word/styles.xml")); for (const token of ["<!--retain-->", "<?audit keep?>", ...(carrier === "direct" ? [] : ['f:identity="retained"'])]) expect(saved.split(token)).toHaveLength(2);
});
