import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value), ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["choice", "fallback", "process-content"] as const)
for (const boundary of ["start", "end", "empty"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} preserves ${boundary} cached-break fragment absence with ${carrier} local namespaces; strict=${strict}; kind=${kind}`, async () => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const active = `<k:r>${boundary === "end" ? "<k:t>Before</k:t>" : ""}<k:lastRenderedPageBreak/>${boundary === "start" ? "<k:t>After</k:t>" : ""}</k:r>`;
  const inactive = "<w:r><w:t>Inactive</w:t><w:lastRenderedPageBreak/></w:r>";
  const mc = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:u="urn:coastal:future"';
  const body = carrier === "process-content" ? `<u:payload ${mc} xmlns:k="${word}" mc:Ignorable="u" mc:ProcessContent="u:payload">${active}</u:payload>` :
    `<mc:AlternateContent ${mc}><mc:Choice xmlns:k="${word}" Requires="${carrier === "choice" ? "w" : "u"}">${carrier === "choice" ? active : inactive}</mc:Choice><mc:Fallback xmlns:k="${word}">${carrier === "choice" ? inactive : active}</mc:Fallback></mc:AlternateContent>`;
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p>${body}</w:p>`);
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" }), expected = [boundary === "end" ? "Before" : null, boundary === "start" ? "After" : null];
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.rendered_page_breaks.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "breaks" },
    { operation: "model.text.pagebreak.RenderedPageBreak.preceding_paragraph_fragment.get", receiver: ref("breaks", 0), arguments: {}, resultHandle: "before" },
    { operation: "model.text.pagebreak.RenderedPageBreak.following_paragraph_fragment.get", receiver: ref("breaks", 0), arguments: {}, resultHandle: "after" },
    ...expected.flatMap((value, index) => value === null ? [] : [{ operation: "model.text.paragraph.Paragraph.text.get", receiver: ref(index === 0 ? "before" : "after"), arguments: {} }])
  ];
  if (route === "model") {
    const doc = await api.Document(input, textContext), cached = doc.paragraphs[0]!.rendered_page_breaks[0]!;
    expect([cached.preceding_paragraph_fragment?.text ?? null, cached.following_paragraph_fragment?.text ?? null]).toEqual(expected);
    await doc.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    expect(result.results.slice(2, 4).map(item => item.value === null)).toEqual(expected.map(value => value === null));
    expect(result.results.slice(4).map(item => item.value)).toEqual(expected.filter(value => value !== null));
    await result.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); const data = JSON.parse(result.stdout);
      expect(data.data.results.slice(2, 4).map((item: { data: unknown }) => item.data === null)).toEqual(expected.map(value => value === null));
      expect(data.data.results.slice(4).map((item: { data: unknown }) => item.data)).toEqual(expected.filter(value => value !== null));
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (route !== "shell") expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(readPackage(input));
});
