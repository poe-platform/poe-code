import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const carrier of ["choice", "fallback", "process"] as const) for (const domain of ["paragraph-properties"] as const) for (const operation of ["runs.add", "paragraphs.add"] as const) for (const route of ["sdk", "shell"] as const)
 it(`${route} ${operation} rejects forbidden owning property-carrier XML attributes for ${carrier}; strict=${strict}`, async () => {
  const wrap = (active: string) => carrier === "process" ? `<f:pass xmlns:f="urn:original:caret-properties" xml:lang="ja-JP" mc:Ignorable="f" mc:ProcessContent="f:pass">${active}</f:pass>` : `<mc:AlternateContent xmlns:f="urn:original:caret-properties" xml:lang="ja-JP" mc:Ignorable="f" mc:ProcessContent="f:pass"><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}"${carrier === "fallback" ? ' f:identity="retained-properties"' : ""}>${carrier === "choice" ? active : '<w:keepLines/>'}</mc:Choice><mc:Fallback${carrier === "choice" ? ' f:identity="retained-properties"' : ""}>${carrier === "fallback" ? active : '<w:keepLines/>'}</mc:Fallback></mc:AlternateContent>`;
  const leaves = '<f:pass><w:keepNext/></f:pass><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>', props = domain === "paragraph-properties" ? wrap(`<w:pPr>${leaves}</w:pPr>`) : `<w:pPr>${wrap(leaves)}</w:pPr>`;
  const input = await textFixture(`<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">${props}<w:r><w:t>c🌊st</w:t></w:r></w:p>`, {}, strict);
    const memory = Volume.fromJSON({ "/rejected": "" });
    if (route === "sdk") await expect(api.editDocumentParagraphs(input, { operation, options: { paragraph: 1, text: "NEW", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/rejected", bytes); } } })).rejects.toMatchObject({ code: "invalid-xml" });
    else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec(`docx ${operation.split(".").join(" ")} /input --paragraph 1 --text NEW --output - > /out`); expect(result.exitCode).toBe(1); expect(result.stderr).toContain("invalid-xml"); expect(await fs.readFile("/input")).toEqual(input); expect((await fs.readFile("/out")).length).toBe(0); } finally { await shell.dispose(); } }
    expect(memory.readFileSync("/rejected").length).toBe(0); return;
 });
