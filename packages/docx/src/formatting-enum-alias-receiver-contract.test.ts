import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const enc = (s: string) => new TextEncoder().encode(s), ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const placement of ["container", "leaf"] as const) for (const state of ["theme", "null", "wrong-family"] as const)
for (const route of ["sdk", "shell"] as const)
it(`${route} treats declared MSO_THEME_COLOR_INDEX receiver as canonical getter enum; ${state}; ${carrier}; ${placement}; ${kind}; strict=${strict}`, async () => {
  const wrap = (text: string) => carrier === "direct" ? text : carrier === "process" ? `<f:pass>${text}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? text : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? text : ""}</mc:Fallback></mc:AlternateContent>`;
  const field = state === "null" ? '<w:color w:val="123456"/>' : '<w:color w:val="123456" w:themeColor="accent1"/>', property = placement === "leaf" ? wrap(field) : field;
  const parts = readPackage(await textFixture(`<f:pass xmlns:f="urn:original:enum-alias" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:p><w:r>${wrap(`<w:rPr>${property}</w:rPr>`)}<w:t>Retain é 日本 עברית 🌊</w:t></w:r><!--retain--><?policy keep?></w:p></f:pass>`, {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const v = Volume.fromJSON({ "/input": "" }); await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { v.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(v.readFileSync("/input") as Buffer), operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "ps" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: { resultHandle: "ps", index: 0 }, arguments: {}, resultHandle: "rs" },
    { operation: "model.text.run.Run.font.get", receiver: { resultHandle: "rs", index: 0 }, arguments: {}, resultHandle: "font" },
    { operation: "model.text.run.Font.color.get", receiver: ref("font"), arguments: {}, resultHandle: "color" },
    { operation: `model.dml.color.ColorFormat.${state === "wrong-family" ? "type" : "theme_color"}.get`, receiver: ref("color"), arguments: {}, resultHandle: "enum" },
    ...["name.get", "value.get", "toString.call"].map(suffix => ({ operation: `model.enum.dml.MSO_THEME_COLOR_INDEX.${suffix}`, receiver: ref("enum"), arguments: {} }))
  ], batch = { version: 1 as const, operations }, reject = state !== "theme";
  if (route === "sdk") { if (reject) await expect(api.applyStyleModelBatch(input, batch, textContext)).rejects.toMatchObject({ code: "usage" }); else { const r = await api.applyStyleModelBatch(input, batch, textContext); expect(r.affected).toBe(0); expect(r.results.slice(-3).map(r => r.value)).toEqual(["ACCENT_1", 5, "ACCENT_1 (5)"]); } }
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", enc("retained destination")); await fs.writeFile("/ops", enc(JSON.stringify(batch))); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const r = await shell.exec("docx batch /input --ops-file /ops --json"); expect(r.exitCode, r.stdout + r.stderr).toBe(reject ? 2 : 0); const e = JSON.parse(r.stdout); expect(e.affected).toBe(0); if (reject) { expect(e.errors[0].code).toBe("usage"); expect(e.data).toBeNull(); } else { expect(e.data.publication).toBeNull(); expect(e.data.results.slice(-3).map((r: { data: unknown }) => r.data)).toEqual(["ACCENT_1", 5, "ACCENT_1 (5)"]); } expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/destination")).toEqual(enc("retained destination")); } finally { await shell.dispose(); } }
  expect(readPackage(input)).toEqual(parts); expect(v.readFileSync("/input")).toEqual(Buffer.from(input)); expect((await api.Document(input, textContext)).paragraphs[0]!.text).toBe("Retain é 日本 עברית 🌊");
});
