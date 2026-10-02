import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
import { parseDocumentXml } from "./package-xml.js";
import { activeXmlChildren } from "./xml-active-children.js";
import { DocumentBudget } from "./budget.js";

for (const strict of [false, true]) for (const carrier of ["simple", "choice", "fallback", "process"] as const) for (const domain of ["paragraph", "run-text", "run-properties", "multiple-runs"] as const) for (const route of ["sdk", "shell"] as const)
 it(`${route} bookmarks scalar content through ${domain} ${carrier} with a zero-width cache; strict=${strict}`, async () => {
  const wrap = (active: string) => carrier === "simple" ? active : carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque f:identity="one-owner"/>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}"${carrier === "fallback" ? ' f:identity="one-owner"' : ""}>${carrier === "choice" ? active : ""}</mc:Choice><mc:Fallback${carrier === "choice" ? ' f:identity="one-owner"' : ""}>${carrier === "fallback" ? active : ""}</mc:Fallback></mc:AlternateContent>`;
  const props = '<w:rPr><w:b/><w:rtl/></w:rPr>', text = '<w:lastRenderedPageBreak/><w:t xml:lang="ja-JP">c🌊st</w:t>', run = `<w:r>${domain === "run-properties" ? wrap(props) : props}${domain === "run-text" ? wrap(text) : text}</w:r>`;
  const input = await textFixture(`<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:bookmark-caret" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:pPr><w:keepNext/></w:pPr>${domain === "multiple-runs" ? wrap(`<w:r>${props}<w:lastRenderedPageBreak/><w:t xml:lang="ja-JP">c🌊</w:t></w:r><w:r>${props}<w:t xml:lang="ja-JP">st</w:t></w:r>`) : domain === "paragraph" ? wrap(run) : run}</w:p>`, {}, strict), locations = await api.openDocumentLocations(input, textContext), select = locations.range(locations.at("paragraph", 1).token, 1, 3).token, memory = Volume.fromJSON({ "/out": "" });
  if (route === "sdk") await api.editDocumentBookmarks(input, { operation: "bookmarks.add", options: { select, name: "Coast", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec(`docx bookmarks add /input --select '${select}' --name Coast --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); } }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const doc = await api.Document(output, textContext); expect(doc.paragraphs[0]!.text).toBe("c🌊st"); expect(doc.paragraphs[0]!.rendered_page_breaks).toHaveLength(1); expect(doc.paragraphs[0]!.runs.every(r => r.bold === true && r.font.rtl === true)).toBe(true); expect(doc.paragraphs[0]!.paragraph_format.keep_with_next).toBe(true);
  const root = parseDocumentXml(after.get("word/document.xml")!).root, children = activeXmlChildren(root, new DocumentBudget()), textParts = ["", "", ""]; let position = 0;
  const visit = (node: typeof root): void => { if (node.localName === "bookmarkStart") position = 1; if (node.localName === "bookmarkEnd") position = 2; if (node.localName === "t") textParts[position] += node.text; for (const child of children(node)) visit(child); }; visit(root); expect(textParts).toEqual(["c", "🌊s", "t"]);
  const xml = new TextDecoder().decode(after.get("word/document.xml")); if (carrier !== "simple") expect(xml.split('f:identity="one-owner"')).toHaveLength(2); expect(xml).toContain('xml:lang="ja-JP"'); expect((await api.inspectDocumentBookmarks(output, {}, textContext)).issues).toEqual([]);
 });
