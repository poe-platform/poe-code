import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

const fields = [{member: "name", tag: "name", value: "New Native Name"}, {member: "priority", tag: "uiPriority", value: 42}, {member: "hidden", tag: "semiHidden", value: true}, {member: "unhide_when_used", tag: "unhideWhenUsed", value: true}, {member: "quick_style", tag: "qFormat", value: true}];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const field of fields) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} inserts absent native style ${field.member} before ${carrier} retained fields; strict=${strict}; kind=${kind}`, async () => {
  const active = '<w:locked f:canary="original"/><w:rPr><w:i/></w:rPr>', wrap = carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque f:identity="retained"/>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}"${carrier === "fallback" ? ' f:identity="retained"' : ""}>${carrier === "choice" ? active : ""}</mc:Choice><mc:Fallback${carrier === "choice" ? ' f:identity="retained"' : ""}>${carrier === "fallback" ? active : ""}</mc:Fallback></mc:AlternateContent>`;
  const input0 = await textFixture('<w:p><w:r><w:t>Original é 日本 עברית 🌊</w:t></w:r></w:p>', {styles: {kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:style-field" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:style w:type="paragraph" w:styleId="selected">${wrap}<!--retain--><?audit keep?></w:style></w:styles>`}}, strict), parts = readPackage(input0), memory = Volume.fromJSON({"/input": "", "/out": ""});
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  await api.writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/out", bytes);}}, operations = [
    {operation: "model.document.Document.styles.get", receiver: {resultHandle: "document"}, arguments: {}, resultHandle: "styles"},
    {operation: "model.styles.styles.Styles.__iter__.call", receiver: {resultHandle: "styles"}, arguments: {}, resultHandle: "items"},
    {operation: `model.styles.style.BaseStyle.${field.member}.set`, receiver: {resultHandle: "items", index: 0}, arguments: {value: field.value}}
  ];
  if (route === "model") {const doc = await api.Document(input, textContext), style = [...doc.styles][0]!; Reflect.set(style, field.member, field.value); expect(Reflect.get(style, field.member)).toBe(field.value); await doc.save(sink);}
  else if (route === "sdk") await (await api.applyStyleModelBatch(input, {version: 1, operations}, textContext)).save(sink);
  else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: api.createDocxInspectionCommandEngine({limits: textContext.limits})})); try {const r = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({version: 1, operations})}' --output /out --json`); expect(r.exitCode, r.stdout + r.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out"));} finally {await shell.dispose();}}
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), after = readPackage(output); assertPackageLinks(after); for (const [name, bytes] of parts) if (name !== "word/styles.xml") expect(after.get(name), name).toEqual(bytes);
  const doc = await api.Document(output, textContext), selected = [...doc.styles][0] as api.ParagraphStyle; expect(Reflect.get(selected, field.member)).toBe(field.value); expect(selected.locked).toBe(true); expect(selected.font.italic).toBe(true); expect(doc.paragraphs[0]!.text).toBe("Original é 日本 עברית 🌊");
  const saved = new TextDecoder().decode(after.get("word/styles.xml")); for (const token of ['f:canary="original"', "<!--retain-->", "<?audit keep?>", ...(carrier === "direct" ? [] : ['f:identity="retained"'])]) expect(saved.split(token)).toHaveLength(2);
});
