import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "choice-empty", "fallback-empty", "process-content", "ignorable", "opaque"] as const)
for (const owner of ["Paragraph", "Run", "Hyperlink"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} reads ${owner} cached break presence from ${carrier} content; strict=${strict}; kind=${kind}`, async () => {
  const marker = "<w:lastRenderedPageBreak/>", mc = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:u="urn:coastal:future"';
  const expected = ["direct", "choice", "fallback", "process-content"].includes(carrier);
  const content = carrier === "direct" ? marker : carrier === "opaque" ? `<u:payload ${mc}>${marker}</u:payload>` :
    carrier === "ignorable" || carrier === "process-content" ? `<u:payload ${mc} mc:Ignorable="u"${carrier === "process-content" ? ' mc:ProcessContent="u:payload"' : ""}>${marker}</u:payload>` :
    `<mc:AlternateContent ${mc}><mc:Choice Requires="${carrier.startsWith("choice") ? "w" : "u"}">${carrier === "choice" || carrier === "fallback-empty" ? marker : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" || carrier === "choice-empty" ? marker : ""}</mc:Fallback></mc:AlternateContent>`;
  const run = `<w:r><w:t>Before</w:t>${content}<w:t>After</w:t></w:r>`;
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p>${owner === "Hyperlink" ? `<w:hyperlink>${run}</w:hyperlink>` : run}</w:p>`);
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    ...(owner === "Paragraph" ? [] : [{ operation: `model.text.paragraph.Paragraph.${owner === "Run" ? "runs" : "hyperlinks"}.get`, receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "owners" }]),
    { operation: `model.text.${owner.toLowerCase()}.${owner}.contains_page_break.get`, receiver: ref(owner === "Paragraph" ? "paragraphs" : "owners", 0), arguments: {} }
  ];
  if (route === "model") {
    const doc = await api.Document(input, textContext), p = doc.paragraphs[0]!;
    const selected = owner === "Paragraph" ? p : owner === "Run" ? p.runs[0]! : p.hyperlinks[0]!;
    expect(selected.contains_page_break).toBe(expected);
    expect(p.rendered_page_breaks).toHaveLength(expected ? 1 : 0);
    expect(p.text).toBe("BeforeAfter");
    await doc.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    expect(result.results.at(-1)!.value).toBe(expected); expect(result.affected).toBe(0);
    await result.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); const data = JSON.parse(result.stdout);
      expect(data.affected).toBe(0); expect(data.data.results.at(-1).data).toBe(expected);
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (route !== "shell") expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(readPackage(input));
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
