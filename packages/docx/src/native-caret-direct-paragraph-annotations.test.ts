import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const carrier of ["direct"] as const) for (const operation of ["runs.add", "paragraphs.add"] as const) for (const route of ["sdk", "shell"] as const)
 it(`${route} ${operation} retains direct paragraph XML annotations for ${carrier}; strict=${strict}`, async () => {
  const props = '<w:pPr><w:keepNext/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>';
  const input = await textFixture(`<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">${props}<!--direct-paragraph--><?original keep?><w:r><w:t>c🌊st</w:t></w:r></w:p>`, {}, strict);
  const locations = await api.openDocumentLocations(input, textContext), p = locations.at("paragraph", 1), select = locations.range(p.token, 2, 2).token, memory = Volume.fromJSON({ "/out": "" });
  if (route === "sdk") await api.editDocumentParagraphs(input, { operation, options: { select, text: "NEW", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec(`docx ${operation.split(".").join(" ")} /input --select '${select}' --text NEW --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); } }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const doc = await api.Document(output, textContext); expect(doc.paragraphs.map(p => p.text)).toEqual(operation === "runs.add" ? ["c🌊NEWst"] : ["c🌊", "NEW", "st"]); expect(doc.paragraphs[0]!.paragraph_format.keep_with_next).toBe(true); if (operation === "paragraphs.add") expect(doc.paragraphs[2]!.paragraph_format.keep_with_next).toBe(true);
  const xml = new TextDecoder().decode(after.get("word/document.xml")); expect(xml.split("<w:sectPr>")).toHaveLength(2); expect(xml.split("<!--direct-paragraph-->")).toHaveLength(2); expect(xml.split("<?original keep?>")).toHaveLength(2);
 });
