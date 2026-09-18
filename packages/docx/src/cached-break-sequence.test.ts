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
for (const carrier of ["direct", "choice", "fallback", "process-content"] as const)
for (const placement of ["marker"])
for (const hyperlink of [false, true]) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} extracts second cached-break fragments through ${carrier} ${placement}; hyperlink=${hyperlink}; strict=${strict}; kind=${kind}`, async () => {
  const marker = "<w:lastRenderedPageBreak/>", mc = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:u="urn:coastal:future"';
  const wrap = (active: string, inactive: string) => carrier === "direct" ? active : carrier === "process-content" ? `<u:payload ${mc} mc:Ignorable="u" mc:ProcessContent="u:payload">${active}</u:payload>` :
    `<mc:AlternateContent ${mc}><mc:Choice Requires="${carrier === "choice" ? "w" : "u"}">${carrier === "choice" ? active : inactive}</mc:Choice><mc:Fallback>${carrier === "choice" ? inactive : active}</mc:Fallback></mc:AlternateContent>`;
  const run = `<w:r><w:t>Before</w:t>${marker}<w:t>Middle</w:t>${placement === "marker" ? wrap(marker, marker) : marker}<w:t>After</w:t></w:r>`;
  const native = hyperlink ? `<w:hyperlink>${run}</w:hyperlink>` : run;
  const target = placement === "run" ? wrap(native, `<w:r><w:t>Inactive</w:t>${marker}</w:r>`) : native;
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p><w:r><w:t>Start </w:t></w:r>${target}<w:r><w:t> Finish</w:t></w:r></w:p>`);
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const expected = hyperlink ? ["Start BeforeMiddleAfter", " Finish"] : ["Start BeforeMiddle", "After Finish"];
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.rendered_page_breaks.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "breaks" },
    { operation: "model.text.pagebreak.RenderedPageBreak.preceding_paragraph_fragment.get", receiver: ref("breaks", 1), arguments: {}, resultHandle: "before" },
    { operation: "model.text.pagebreak.RenderedPageBreak.following_paragraph_fragment.get", receiver: ref("breaks", 1), arguments: {}, resultHandle: "after" },
    { operation: "model.text.paragraph.Paragraph.text.get", receiver: ref("before"), arguments: {} },
    { operation: "model.text.paragraph.Paragraph.text.get", receiver: ref("after"), arguments: {} }
  ];
  if (route === "model") {
    const doc = await api.Document(input, textContext), p = doc.paragraphs[0]!;
    expect(p.rendered_page_breaks).toHaveLength(2);
    const cached = p.rendered_page_breaks[1]!, before = cached.preceding_paragraph_fragment, after = cached.following_paragraph_fragment;
    expect([before?.text, after?.text]).toEqual(expected);
    before!.runs[0]!.bold = true; after!.runs.at(-1)!.italic = true;
    expect(p.runs[0]!.bold).toBeNull(); expect(p.runs.at(-1)!.italic).toBeNull();
    expect(p.text).toBe("Start BeforeMiddleAfter Finish");
    await doc.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    expect(result.results.slice(-2).map(item => item.value)).toEqual(expected); expect(result.affected).toBe(0);
    await result.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); const data = JSON.parse(result.stdout);
      expect(data.affected).toBe(0); expect(data.data.results.slice(-2).map((item: { data: unknown }) => item.data)).toEqual(expected);
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (route !== "shell") expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(readPackage(input));
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
