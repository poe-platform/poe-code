import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
const enc = (s: string) => new TextEncoder().encode(s), ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const type of ["paragraph", "numbering"] as const) for (const carrier of ["choice", "fallback", "opaque"] as const)
for (const route of ["model", "sdk", "shell", "sdk-direct", "shell-direct", "create-sdk", "create-shell"] as const)
it(`${route} allocates collision-free ${type} style ID around ${carrier} native inert definitions; ${kind}; strict=${strict}`, async () => {
  const active = '<w:style w:type="paragraph" w:styleId="Style1"><w:name w:val="Retained"/></w:style>', inactive = '<w:style w:type="paragraph" w:styleId="Style2"><w:name w:val="Inert"/></w:style>';
  const definitions = carrier === "opaque" ? active + `<f:shadow>${inactive}</f:shadow>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inactive}</mc:Fallback></mc:AlternateContent>`;
  const parts = readPackage(await textFixture('<w:p><w:pPr><w:pStyle w:val="Style1"/></w:pPr><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:style-id" mc:Ignorable="f">${definitions}<!--retain--><?policy keep?></w:styles>` } }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const v = Volume.fromJSON({ "/input": "", "/out": "" }); await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([n, bytes]) => ({ name: n, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { v.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(v.readFileSync("/input") as Buffer), sink = { async write(bytes: Uint8Array) { v.appendFileSync("/out", bytes); } }, family = type === "paragraph" ? api.WD_STYLE_TYPE.PARAGRAPH : api.WD_STYLE_TYPE.LIST, operations = [{ operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" }, { operation: "model.styles.styles.Styles.add_style.call", receiver: ref("styles"), arguments: { name: "Added", styleType: family } }], content = { version: 1 as const, styles: [{ name: "Added", type: "paragraph" as const }], blocks: [] }, pub = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink };
  if (route === "model") { const doc = await api.Document(input, textContext); doc.styles.add_style("Added", family); await doc.save(sink); }
  else if (route === "sdk") { const r = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); await r.save(sink); }
  else if (route === "sdk-direct") await api.editDocumentStyles(input, { operation: "styles.add", name: "Added", type, output: "-" }, pub);
  else if (route === "create-sdk") {
    if (type === "numbering") { await expect(api.createDocument({ template: input, content: { ...content, styles: [{ name: "Added", type: "numbering" as never }] } }, { output: "-" }, pub)).rejects.toMatchObject({ code: "usage" }); expect(v.readFileSync("/out")).toHaveLength(0); expect(v.readFileSync("/input")).toEqual(Buffer.from(input)); return; }
    await api.createDocument({ template: input, content }, { output: "-" }, pub);
  } else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", enc("retained destination")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations }))); await fs.writeFile("/content", enc(JSON.stringify(type === "numbering" ? { ...content, styles: [{ name: "Added", type }] } : content))); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try {
    const r = await shell.exec(route === "shell-direct" ? `docx styles add /input --name Added --type ${type} --output /out --force --json` : route === "create-shell" ? "docx create --template /input --content-file /content --output /out --force --json" : "docx batch /input --ops-file /ops --output /out --force --json");
    if (route === "create-shell" && type === "numbering") { expect(r.exitCode, r.stdout + r.stderr).toBe(2); expect(JSON.parse(r.stdout).errors[0].code).toBe("usage"); expect(await fs.readFile("/out")).toEqual(enc("retained destination")); expect(await fs.readFile("/input")).toEqual(input); return; }
    expect(r.exitCode, r.stdout + r.stderr).toBe(0); v.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input);
  } finally { await shell.dispose(); } }
  const output = new Uint8Array(v.readFileSync("/out") as Buffer), saved = readPackage(output); assertPackageLinks(saved); for (const [n, bytes] of parts) if (n !== "word/styles.xml") expect(saved.get(n), n).toEqual(bytes);
  const doc = await api.Document(output, textContext); expect(doc.styles.at("Added").style_id).toBe("Style3"); expect(doc.paragraphs[0]!.style!.style_id).toBe("Style1"); expect(doc.paragraphs[0]!.text).toBe("Retain é 日本 עברית 🌊"); expect(new TextDecoder().decode(saved.get("word/styles.xml"))).toContain(inactive); expect(v.readFileSync("/input")).toEqual(Buffer.from(input));
});
