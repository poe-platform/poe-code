import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const leaf of ["noBreakHyphen", "softHyphen"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} retains the logical Unicode ${leaf} through ${carrier} model views; strict=${strict}`, async () => {
  const character = leaf === "noBreakHyphen" ? "\u2011" : "\u00ad", marker = `<w:${leaf}/>`;
  const wrapped = carrier === "direct" ? marker : carrier === "process" ? `<f:pass>${marker}</f:pass><f:opaque f:identity="retained"><w:t>Inactive</w:t></f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}"${carrier === "fallback" ? ' f:identity="retained"' : ""}>${carrier === "choice" ? marker : '<w:t>Inactive</w:t>'}</mc:Choice><mc:Fallback${carrier === "choice" ? ' f:identity="retained"' : ""}>${carrier === "fallback" ? marker : '<w:t>Inactive</w:t>'}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture(`<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:hyphen-unicode" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/><w:rtl/></w:rPr><w:t>é 日本 עברית 🌊</w:t>${wrapped}<w:t>after</w:t></w:r></w:p>`, {}, strict), expected = `é 日本 עברית 🌊${character}after`, memory = Volume.fromJSON({ "/out": "" });
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" },
    { operation: "model.text.paragraph.Paragraph.text.get", receiver: ref("paragraphs", 0), arguments: {} },
    { operation: "model.text.run.Run.text.get", receiver: ref("runs", 0), arguments: {} },
    { operation: "model.text.run.Run.iter_inner_content.call", receiver: ref("runs", 0), arguments: {} }
  ];
  if (route === "model") {
    const doc = await api.Document(input, textContext), p = doc.paragraphs[0]!, run = p.runs[0]!;
    expect(p.text).toBe(expected); expect(run.text).toBe(expected); expect([...run.iter_inner_content()]).toEqual([expected]);
    expect(run.bold).toBe(true); expect(run.font.rtl).toBe(true);
    await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
  } else if (route === "sdk") {
    const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    expect(batch.results.slice(2).map(r => r.value)).toEqual([expected, expected, [expected]]);
    await batch.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.slice(2).map((r: { data: unknown }) => r.data)).toEqual([expected, expected, [expected]]); expect(await fs.readFile("/input")).toEqual(input); await (await api.Document(input, textContext)).save({ async write(bytes) { memory.appendFileSync("/out", bytes); } }); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
  for (const [name, bytes] of before) expect(after.get(name), name).toEqual(bytes);
  expect((await api.extractDocumentText(output, textContext)).text).toBe(expected);
});
