import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process"] as const)
 for (const override of [false, true]) for (const route of ["sdk", "shell"] as const)
 it(`${route} preserving replacement retains native leaf XML language/base context in ${carrier}; override=${override} strict=${strict}`, async () => {
  const active = '<w:t xml:lang="ja-JP" xml:base="../leaf/" xml:space="preserve">coast</w:t>', inactive = '<w:t>Inactive</w:t>';
  const content = carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque>${inactive}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inactive}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture(`<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:leaf-context" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:r xml:lang="en-US" xml:base="root/"><w:rPr><w:b/><w:rtl/></w:rPr>${content}</w:r></w:p>`, {}, strict);
  const memory = Volume.fromJSON({ "/out": "" });
  if (route === "sdk") await api.replaceDocumentText(input, { find: "oas", with: "🌊日本\tעברית\n é", all: true, ...(override ? { bold: false } : {}), output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } });
  else {
   const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const result = await shell.exec(`docx text replace /input --find oas --with '🌊日本\tעברית\n é' --all${override ? " --bold false" : ""} --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const doc = await api.Document(output, textContext); expect(doc.paragraphs[0]!.text).toBe("c🌊日本\tעברית\n ét"); expect(doc.paragraphs[0]!.runs.every(run => run.font.rtl)).toBe(true);
  const leaves: api.XmlElement[] = [];
  const visit = (node: api.XmlElement): void => { if (node.namespace === doc.paragraphs[0]!.runs[0]!.element.namespace && ["t", "br", "tab"].includes(node.localName) && node.text !== "Inactive") leaves.push(node); for (const child of node.children) visit(child); };
  visit(api.parseDocumentXml(after.get("word/document.xml")!).root);
  expect(leaves.length).toBeGreaterThan(0);
  for (const leaf of leaves) { expect(leaf.attributes.find(a => a.namespace === "http://www.w3.org/XML/1998/namespace" && a.localName === "lang")?.value, leaf.localName).toBe("ja-JP"); expect(leaf.attributes.find(a => a.namespace === "http://www.w3.org/XML/1998/namespace" && a.localName === "base")?.value, leaf.localName).toBe("../leaf/"); }
 });
