import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const controls = [
  { xml: '<w:ptab w:alignment="left" w:relativeTo="margin" w:leader="none"/>', text: "\t", name: "positional-tab" },
  { xml: "<w:noBreakHyphen/>", text: "\u2011", name: "non-breaking-hyphen" },
  { xml: "<w:softHyphen/>", text: "\u00ad", name: "soft-hyphen" }
];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const control of controls) for (const preceding of [false, true]) for (const route of ["model", "sdk", "cli"])
it(`${route} retains a ${control.name}-only cached-break fragment; preceding=${preceding}; strict=${strict}; kind=${kind}`, async () => {
  const marker = "<w:lastRenderedPageBreak/>",
    body = `<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:i/></w:rPr>${preceding ? control.xml + marker : marker + control.xml}</w:r><!--retain--><?control keep?></w:p>`;
  const parts = readPackage(await textFixture(body, {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) },
    { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), document = await api.Document(input, textContext);
  expect(document.paragraphs[0]!.text).toBe(control.text);
  expect(document.paragraphs[0]!.rendered_page_breaks).toHaveLength(1);
  const selected = preceding ? "preceding_paragraph_fragment" : "following_paragraph_fragment",
    opposite = preceding ? "following_paragraph_fragment" : "preceding_paragraph_fragment";
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "p" },
    { operation: "model.text.paragraph.Paragraph.rendered_page_breaks.get", receiver: ref("p", 0), arguments: {}, resultHandle: "breaks" },
    { operation: `model.text.pagebreak.RenderedPageBreak.${opposite}.get`, receiver: ref("breaks", 0), arguments: {} },
    { operation: `model.text.pagebreak.RenderedPageBreak.${selected}.get`, receiver: ref("breaks", 0), arguments: {}, resultHandle: "fragment" },
    { operation: "model.text.paragraph.Paragraph.text.get", receiver: ref("fragment"), arguments: {} }
  ];
  if (route === "model") {
    const cached = document.paragraphs[0]!.rendered_page_breaks[0]!;
    expect(cached[opposite]).toBeNull();
    const fragment = cached[selected];
    expect(fragment).toBeInstanceOf(api.Paragraph);
    expect(fragment!.text).toBe(control.text);
    expect(fragment!.paragraph_format.keep_with_next).toBe(true);
    expect(fragment!.runs[0]!.italic).toBe(true);
    expect(fragment!.store).not.toBe(document.store);
    await document.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    expect(result.results[2]!.value).toBeNull();
    expect(result.results[3]!.value).toMatchObject({ type: "Paragraph" });
    expect(result.results[4]!.value).toBe(control.text);
    await result.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const data = JSON.parse(result.stdout); expect(data.ok).toBe(true); expect(data.affected).toBe(0);
      expect(data.data.results[2].data).toBeNull(); expect(data.data.results[3].data).toMatchObject({ type: "Paragraph" }); expect(data.data.results[4].data).toBe(control.text);
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (route !== "cli") expect(readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer))).toEqual(parts);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
