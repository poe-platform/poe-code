import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
const enc = (s: string) => new TextEncoder().encode(s), ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const placement of ["style", "name"] as const)
for (const name of ["heading 1", "Heading 1"])
for (const action of ["inspect", "alias-refuse", "add", "apply", "template", "declaration"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} preserves exact custom style ${name}; action=${action}; carrier=${carrier}; placement=${placement}; ${kind}; strict=${strict}`, async () => {
  const wrap = (value: string) => carrier === "direct" ? value : carrier === "process" ? `<f:pass>${value}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? value : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? value : ""}</mc:Fallback></mc:AlternateContent>`;
  const style = (n: string, id: string) => `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}">${placement === "name" ? wrap(`<w:name w:val="${n}"/>`) : `<w:name w:val="${n}"/>`}<w:rPr><w:rtl/><w:lang w:val="he-IL"/></w:rPr></w:style>`;
  const styles = action === "add" || action === "declaration" ? "" : action === "alias-refuse" ? (placement === "style" ? wrap(style("heading 1", "lower")) : style("heading 1", "lower")) : (placement === "style" ? wrap(style("heading 1", "lower")) + wrap(style("Heading 1", "upper")) : style("heading 1", "lower") + style("Heading 1", "upper"));
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:custom-style" mc:Ignorable="f" mc:ProcessContent="f:pass">${styles}<w:style w:type="paragraph" w:styleId="BuiltinHeader"><w:name w:val="header"/></w:style><!--retain--><?policy keep?></w:styles>` } }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const v = Volume.fromJSON({ "/input": "", "/out": "" }); await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([n, bytes]) => ({ name: n, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { v.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(v.readFileSync("/input") as Buffer), sink = { async write(bytes: Uint8Array) { v.appendFileSync("/out", bytes); } }, context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink }, id = name === "heading 1" ? "lower" : "upper";
  const content = { version: 1 as const, ...(action === "declaration" ? { styles: [{ name: "heading 1", type: "paragraph" as const }, { name: "Heading 1", type: "paragraph" as const }] } : {}), blocks: [{ kind: "paragraph" as const, text: "Added 日本 עברית", style: name }] };
  const operations = [{ operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" }, { operation: "model.styles.styles.Styles.add_style.call", receiver: ref("styles"), arguments: { name, styleType: { enum: "WD_STYLE_TYPE", name: "PARAGRAPH" }, builtin: false }, resultHandle: "added" }, { operation: "model.styles.style.BaseStyle.name.get", receiver: ref("added"), arguments: {} }];
  if (route === "model") {
    const doc = await api.Document(action === "template" ? undefined : input, action === "template" ? { ...textContext, template: input } : textContext);
    expect(doc.styles.at("Header").name).toBe("Header"); expect(doc.styles.at("header").style_id).toBe("BuiltinHeader");
    if (action === "alias-refuse") { expect(doc.styles.has("Heading 1")).toBe(false); expect(() => doc.styles.at("Heading 1")).toThrow(api.MissingKeyError); }
    else if (action === "inspect") { expect(doc.styles.at(name).name).toBe(name); expect(doc.styles.at(name).style_id).toBe(id); }
    else if (action === "add") expect(doc.styles.add_style(name, api.WD_STYLE_TYPE.PARAGRAPH).name).toBe(name);
    else if (action === "declaration") { doc.styles.add_style("heading 1", api.WD_STYLE_TYPE.PARAGRAPH); doc.styles.add_style("Heading 1", api.WD_STYLE_TYPE.PARAGRAPH); doc.add_paragraph("Added 日本 עברית", name); }
    else if (action === "apply") doc.paragraphs[0]!.style = name;
    else doc.add_paragraph("Added 日本 עברית", name);
    await doc.save(sink);
  } else if (route === "sdk") {
    if (action === "alias-refuse") await expect(api.inspectDocumentStyles(input, { name: "Heading 1" }, textContext)).rejects.toMatchObject({ code: "missing-selection" });
    else if (action === "inspect") { const data = await api.inspectDocumentStyles(input, { name }, textContext); expect(data.styles.map(s => [s.name, s.id])).toEqual([[name, id]]); }
    else if (action === "add") { const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); expect(result.results.at(-1)!.value).toBe(name); await result.save(sink); }
    else if (action === "apply") await api.editDocumentParagraphs(input, { operation: "paragraphs.set", options: { paragraph: 1, style: name, output: "-" } }, context);
    else await api.createDocument({ template: input, content }, { output: "-" }, context);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", enc("retained destination")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations }))); await fs.writeFile("/content", enc(JSON.stringify(content)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const cmd = action === "inspect" || action === "alias-refuse" ? `docx styles get /input --name '${action === "alias-refuse" ? "Heading 1" : name}' --json` : action === "add" ? "docx batch /input --ops-file /ops --output /out --force --json" : action === "apply" ? `docx paragraphs set /input --paragraph 1 --style '${name}' --output /out --force --json` : "docx create --template /input --content-file /content --output /out --force --json";
      const r = await shell.exec(cmd); expect(r.exitCode, r.stdout + r.stderr).toBe(action === "alias-refuse" ? 1 : 0); const e = JSON.parse(r.stdout);
      if (action === "alias-refuse") { expect(e.errors[0].code).toBe("missing-selection"); expect(e.affected).toBe(0); }
      else if (action === "inspect") expect(e.data.styles.map((s: { name: string; id: string }) => [s.name, s.id])).toEqual([[name, id]]);
      else v.writeFileSync("/out", await fs.readFile("/out"));
      if (action === "inspect" || action === "alias-refuse") expect(await fs.readFile("/out")).toEqual(enc("retained destination")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (v.readFileSync("/out").length) {
    const output = new Uint8Array(v.readFileSync("/out") as Buffer), saved = readPackage(output); assertPackageLinks(saved);
    const dirty = action === "add" ? ["word/styles.xml"] : action === "declaration" ? ["word/styles.xml", "word/document.xml"] : action === "apply" || action === "template" ? ["word/document.xml"] : [];
    for (const [n, bytes] of parts) if (!dirty.includes(n)) expect(saved.get(n), n).toEqual(bytes);
    const doc = await api.Document(output, textContext);
    if (action === "add") { expect(doc.styles.at(name).name).toBe(name); expect(new TextDecoder().decode(saved.get("word/styles.xml"))).toContain(`st:val="${name}"`); }
    if (action === "apply" || action === "template") expect(doc.paragraphs.at(-1)!.style!.style_id).toBe(id);
    if (action === "declaration") expect(doc.paragraphs.at(-1)!.style!.name).toBe(name);
    expect(doc.paragraphs[0]!.text).toBe("Retain é 日本 עברית 🌊"); expect(new TextDecoder().decode(saved.get("word/styles.xml"))).toContain("<!--retain--><?policy keep?>");
  }
  expect(v.readFileSync("/input")).toEqual(Buffer.from(input));
});
