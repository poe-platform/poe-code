import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
const enc = (s: string) => new TextEncoder().encode(s), ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const name of ["caption", "Caption"]) for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const action of ["linked-style", "numbering-paragraph-style"] as const) for (const route of ["model-batch", "sdk-batch", "shell-batch"] as const)
it(`${route} resolves exact custom ${name} for ${action}; ${carrier}; ${kind}; strict=${strict}`, async () => {
  const wrap = (value: string) => carrier === "direct" ? value : carrier === "process" ? `<f:pass>${value}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? value : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? value : ""}</mc:Fallback></mc:AlternateContent>`;
  const type = action === "linked-style" ? "character" : "paragraph", styles = `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:custom-cross-family" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:style w:type="paragraph" w:styleId="Owner"><w:name w:val="Owner"/></w:style>${["caption", "Caption"].map((n, i) => wrap(`<w:style w:type="${type}" w:customStyle="1" w:styleId="${i ? "upper" : "lower"}"><w:name w:val="${n}"/><w:rPr><w:i/><w:rtl/></w:rPr></w:style>`)).join("")}<!--retain--><?policy keep?></w:styles>`;
  const numbering = `<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="7"/></w:num><!--retain--><?policy keep?></w:numbering>`;
  const paragraph = (id: number, text: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const parts = readPackage(await textFixture(paragraph(1, "Selected é 日本 עברית 🌊") + paragraph(1, "Other occurrence"), { styles: { kind: "styles", xml: styles }, numbering: { kind: "numbering", xml: numbering } }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const v = Volume.fromJSON({ "/input": "", "/out": "" }); await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([n, bytes]) => ({ name: n, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { v.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(v.readFileSync("/input") as Buffer), sink = { async write(bytes: Uint8Array) { v.appendFileSync("/out", bytes); } }, operations = action === "linked-style" ? [
    { operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" }, { operation: "model.styles.styles.Styles.__getitem__.call", receiver: ref("styles"), arguments: { key: "Owner" }, resultHandle: "owner" }, { operation: "styles.links.set", receiver: ref("owner"), arguments: { linkedStyle: name } }
  ] : [{ operation: "paragraphs.get", arguments: { paragraph: 1 }, resultHandle: "owner" }, { operation: "lists.levels.set", receiver: ref("owner"), arguments: { levels: [{ level: 0, format: "decimal", text: "%1.", start: 1, paragraphStyle: name }] } }], batch = { version: 1 as const, operations };
  if (route === "model-batch") { const result = await api.applyStyleModelBatch(input, batch, textContext); await result.save(sink); }
  else if (route === "sdk-batch") await api.executeDocumentBatch(input, batch, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify(batch))); await fs.writeFile("/out", enc("retained destination")); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const r = await shell.exec("docx batch /input --ops-file /ops --output /out --force --json"); expect(r.exitCode, r.stdout + r.stderr).toBe(0); v.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); } }
  const output = new Uint8Array(v.readFileSync("/out") as Buffer), saved = readPackage(output); assertPackageLinks(saved); const dirty = action === "linked-style" ? ["word/styles.xml"] : ["word/document.xml", "word/numbering.xml"];
  for (const [n, bytes] of parts) if (!dirty.includes(n)) expect(saved.get(n), n).toEqual(bytes);
  const doc = await api.Document(output, textContext), id = name === "caption" ? "lower" : "upper";
  expect(doc.paragraphs.map(p => p.text)).toEqual(["Selected é 日本 עברית 🌊", "Other occurrence"]);
  const attribute = (node: api.XmlElementView, key = "val") => [...node.attributes].find(([n]) => n.localName === key)?.[1];
  if (action === "linked-style") { expect(attribute(doc.styles.at("Owner").element.children.find(n => n.tag.localName === "link")!)).toBe(id); expect(attribute(doc.styles.at(name).element.children.find(n => n.tag.localName === "link")!)).toBe("Owner"); }
  else { const child = (node: api.XmlElementView, local: string) => node.children.find(n => n.tag.localName === local)!;
    const definitions = doc.part.numbering_part.element, paragraphStyle = (p: api.Paragraph) => {
      const number = attribute(child(child(child(p.element, "pPr"), "numPr"), "numId"));
      const instance = definitions.children.find(n => n.tag.localName === "num" && attribute(n, "numId") === number)!;
      const abstractId = attribute(child(instance, "abstractNumId"));
      const abstract = definitions.children.find(n => n.tag.localName === "abstractNum" && attribute(n, "abstractNumId") === abstractId)!;
      const style = child(abstract, "lvl").children.find(n => n.tag.localName === "pStyle"); return style ? attribute(style) : null;
    }; expect(paragraphStyle(doc.paragraphs[0]!)).toBe(id); expect(paragraphStyle(doc.paragraphs[1]!)).toBeNull(); }
  expect(v.readFileSync("/input")).toEqual(Buffer.from(input));
});
