import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const carrier of ["choice", "fallback", "process"] as const) for (const domain of ["paragraph-properties"] as const) for (const operation of ["runs.add", "paragraphs.add"] as const) for (const route of ["sdk", "shell"] as const)
 it(`${route} ${operation} retains admitted owning property-carrier local MCE scope for ${carrier}; strict=${strict}`, async () => {
  const wrap = (active: string) => carrier === "process" ? `<f:pass xmlns:f="urn:original:caret-properties" mc:Ignorable="f" mc:ProcessContent="f:pass">${active}</f:pass>` : `<mc:AlternateContent xmlns:f="urn:original:caret-properties" mc:Ignorable="f" mc:ProcessContent="f:pass"><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}"${carrier === "fallback" ? ' f:identity="retained-properties"' : ""}>${carrier === "choice" ? active : '<w:keepLines/>'}</mc:Choice><mc:Fallback${carrier === "choice" ? ' f:identity="retained-properties"' : ""}>${carrier === "fallback" ? active : '<w:keepLines/>'}</mc:Fallback></mc:AlternateContent>`;
  const leaves = '<f:pass><w:keepNext/></f:pass><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>', props = domain === "paragraph-properties" ? wrap(`<w:pPr>${leaves}</w:pPr>`) : `<w:pPr>${wrap(leaves)}</w:pPr>`;
  const input = await textFixture(`<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">${props}<w:r><w:t>c🌊st</w:t></w:r></w:p>`, {}, strict);
  const locations = await api.openDocumentLocations(input, textContext), p = locations.at("paragraph", 1), select = locations.range(p.token, 2, 2).token, memory = Volume.fromJSON({ "/out": "" });
  if (route === "sdk") await api.editDocumentParagraphs(input, { operation, options: { select, text: "NEW", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec(`docx ${operation.split(".").join(" ")} /input --select '${select}' --text NEW --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); } }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const doc = await api.Document(output, textContext); expect(doc.paragraphs.map(p => p.text)).toEqual(operation === "runs.add" ? ["c🌊NEWst"] : ["c🌊", "NEW", "st"]); expect(doc.paragraphs[0]!.paragraph_format.keep_with_next).toBe(true); if (operation === "paragraphs.add") expect(doc.paragraphs[2]!.paragraph_format.keep_with_next).toBe(true);
  const xml = new TextDecoder().decode(after.get("word/document.xml")); expect(xml.split("<w:sectPr>")).toHaveLength(2); if (carrier !== "process") expect(xml.split('f:identity="retained-properties"')).toHaveLength(2);
 });
