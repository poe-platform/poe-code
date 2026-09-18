import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

const flags = [
  ["all_caps", "allCaps", "caps", true], ["bold", "bold", "b", true], ["complex_script", "complexScriptEnabled", "cs", false],
  ["cs_bold", "csBold", "bCs", true], ["cs_italic", "csItalic", "iCs", true], ["double_strike", "doubleStrike", "dstrike", true],
  ["emboss", "emboss", "emboss", true], ["hidden", "fontHidden", "vanish", true], ["imprint", "imprint", "imprint", true],
  ["italic", "italic", "i", true], ["math", "math", "oMath", false], ["no_proof", "noProof", "noProof", false],
  ["outline", "outline", "outline", true], ["rtl", "rtl", "rtl", false], ["shadow", "shadow", "shadow", true],
  ["small_caps", "smallCaps", "smallCaps", true], ["snap_to_grid", "snapToGrid", "snapToGrid", false],
  ["spec_vanish", "specVanish", "specVanish", false], ["strike", "strike", "strike", true], ["web_hidden", "webHidden", "webHidden", false]
] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const type of ["paragraph", "character", "table"] as const) for (const carrier of ["direct", "choice", "fallback", "process"] as const) for (const value of [true, false, null]) for (const route of ["model", "sdk", "shell", "sdk-model-batch", "shell-model-batch"] as const)
it(`${route} retains all style font flags and inherited toggles; ${type} ${carrier} value=${value} ${kind} strict=${strict}`, async () => {
  const wrap = (active: string, index: number) => carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque f:identity="leaf${index}"/>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}"${carrier === "fallback" ? ` f:identity="leaf${index}"` : ""}>${carrier === "choice" ? active : ""}</mc:Choice><mc:Fallback${carrier === "choice" ? ` f:identity="leaf${index}"` : ""}>${carrier === "fallback" ? active : ""}</mc:Fallback></mc:AlternateContent>`;
  const initial = value === true ? "0" : "1", props = (val: string, wrapped = false) => flags.map(([, , tag], index) => wrapped ? wrap(`<w:${tag} w:val="${val}"/>`, index) : `<w:${tag} w:val="${val}"/>`).join("");
  const styles = `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:style-flags" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:style w:type="${type}" w:styleId="base"><w:name w:val="Original Base"/><w:rPr>${props("1")}</w:rPr></w:style><w:style w:type="${type}" w:styleId="selected"><w:name w:val="Original Selected"/><w:basedOn w:val="base"/><w:semiHidden/><w:locked/><w:qFormat/><w:pPr><w:keepNext/></w:pPr><w:rPr>${props(initial, true)}<w:color w:val="224466"/><w:rFonts w:ascii="Original Serif" w:eastAsia="日本 Serif" w:cs="Arabic"/><w:lang w:val="en-US" w:eastAsia="ja-JP" w:bidi="he-IL"/></w:rPr><!--retained--><?audit original?></w:style></w:styles>`;
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Unchanged 日本 é 🌊 עברית</w:t></w:r></w:p>', { styles: { kind: "styles", xml: styles } }, strict));
  if (kind === "dotx") {
    const editor = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!), main = editor.root.children.find(n => n.attributes.some(a => a.localName === "PartName" && a.value === "/word/document.xml"))!;
    editor.setAttribute(main, { namespace: "", localName: "ContentType" }, "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"); parts.set("[Content_Types].xml", editor.serialize());
  }
  const volume = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } }, options = { operation: "styles.set" as const, name: "Original Selected", ...Object.fromEntries(flags.map(([, key]) => [key, value])), output: "-" };
  const batch = { version: 1, operations: [
    { operation: "model.document.Document.styles.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.__getitem__.call", receiver: { resultHandle: "styles" }, arguments: { key: "Original Selected" }, resultHandle: "style" },
    { operation: "model.styles.style.CharacterStyle.font.get", receiver: { resultHandle: "style" }, arguments: {}, resultHandle: "font" },
    ...flags.map(([member]) => ({ operation: `model.text.run.Font.${member}.set`, receiver: { resultHandle: "font" }, arguments: { value } }))
  ] };
  if (route === "model") {
    const doc = await api.Document(input, textContext), selected = doc.styles.at("Original Selected"); expect(selected).toBeInstanceOf(api.CharacterStyle);
    const font = (selected as api.CharacterStyle).font;
    for (const [member] of flags) font[member] = value;
    await doc.save(sink);
  } else if (route === "sdk") await api.editDocumentStyles(input, options, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
  else if (route === "sdk-model-batch") await api.executeDocumentBatch(input, batch, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = route === "shell" ? `docx styles set /input --name 'Original Selected' ${flags.map(([, key]) => "--" + [...key].map(c => c >= "A" && c <= "Z" ? "-" + c.toLowerCase() : c).join("") + " " + String(value)).join(" ")} --output - > /out` : `docx batch /input --ops-json '${JSON.stringify(batch)}' --output - > /out`;
      const result = await shell.exec(command); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(result.stdout).toBe(""); expect(await fs.readFile("/input")).toEqual(input); volume.writeFileSync("/out", await fs.readFile("/out"));
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), saved = readPackage(output); assertPackageLinks(saved); expect(saved.size).toBe(parts.size);
  for (const [name, bytes] of parts) if (name !== "word/styles.xml") expect(saved.get(name), name).toEqual(bytes);
  const doc = await api.Document(output, textContext), style = doc.styles.at("Original Selected") as api.CharacterStyle, report = (await api.inspectDocumentStyles(output, { name: "Original Selected" }, textContext)).styles[0]!;
  for (const [member, key, , toggle] of flags) {
    expect(style.font[member], member).toBe(value); expect(report.direct[key], key).toBe(value);
    expect(report.effective![key], key).toBe(value === null ? true : toggle ? value !== true : value);
  }
  expect(report).toMatchObject({ base: "Original Base", hidden: true, locked: true, quickStyle: true, direct: { color: "224466", font: "Original Serif", language: "en-US", keepWithNext: true } });
  expect(doc.paragraphs[0]!.text).toBe("Unchanged 日本 é 🌊 עברית");
  const xml = new TextDecoder().decode(saved.get("word/styles.xml")); expect(xml.split("<!--retained-->")).toHaveLength(2); expect(xml.split("<?audit original?>")).toHaveLength(2);
  if (carrier !== "direct") for (let index = 0; index < flags.length; index++) expect(xml.split(`f:identity="leaf${index}"`)).toHaveLength(2);
  expect(new Uint8Array(volume.readFileSync("/input") as Buffer)).toEqual(input);
});
