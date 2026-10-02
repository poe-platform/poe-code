import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { readPackage } from "../tests/assertions.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

type Assignment = { member: "space_before" | "space_after" | "line_spacing" | "left_indent" | "first_line_indent"; value: api.DocxLength | number | null; invalid: boolean };
const assignments: Assignment[] = [
  ...(["space_before", "space_after", "line_spacing"] as const).flatMap(member => [-1, -0.000001].map(value => ({ member, value: { value, unit: "pt" as const }, invalid: true }))),
  ...[0, -1, 0.000001, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE].map(value => ({ member: "line_spacing" as const, value, invalid: true })),
  ...(["space_before", "space_after", "line_spacing"] as const).flatMap(member => [null, { value: 0, unit: "pt" as const }].map(value => ({ member, value, invalid: false }))),
  { member: "line_spacing", value: 1.5, invalid: false },
  { member: "left_indent", value: { value: -1, unit: "pt" }, invalid: false },
  { member: "first_line_indent", value: { value: -1, unit: "pt" }, invalid: false }
];
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["paragraph", "style"] as const) for (const route of ["model", "model-batch", "ordered-sdk", "cli"] as const)
for (const assignment of assignments)
it(`${route} ${assignment.invalid ? "rejects" : "retains"} native ${owner} ${assignment.member}=${JSON.stringify(assignment.value)}; ${kind} strict=${strict}`, async () => {
  const props = '<w:pPr><!--before--><w:spacing w:before="120" w:after="180" w:line="240" w:lineRule="auto"/><w:ind w:left="360" w:firstLine="240"/><w:keepNext/><?retain owner?></w:pPr>';
  const parts = readPackage(await textFixture(`<w:p>${props}<w:r><w:rPr><w:b/></w:rPr><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>`, { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Coast"><w:name w:val="Coast"/>${props}</w:style></w:styles>` } }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const operations: unknown[] = owner === "style" ? [
    { operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.__getitem__.call", receiver: ref("styles"), arguments: { key: "Coast" }, resultHandle: "style" },
    { operation: "model.styles.style.ParagraphStyle.paragraph_format.get", receiver: ref("style"), arguments: {}, resultHandle: "format" }
  ] : [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "format" }
  ];
  operations.push({ operation: `model.text.parfmt.ParagraphFormat.${assignment.member}.set`, receiver: ref("format"), arguments: { value: assignment.value } });
  const batch = { version: 1 as const, operations };
  if (route === "model") {
    const document = await api.Document(input, textContext), before = document.part.blob, styleBefore = document.styles.element.serialize();
    const format = owner === "style" ? (document.styles.at("Coast") as api.ParagraphStyle).paragraph_format : document.paragraphs[0]!.paragraph_format;
    const assign = () => { if (assignment.member === "line_spacing") format.line_spacing = assignment.value; else format[assignment.member] = assignment.value as api.DocxLength | null; };
    if (assignment.invalid) {
      expect(assign).toThrowError(expect.objectContaining({ code: "usage" }));
      expect(document.part.blob).toEqual(before); expect(document.styles.element.serialize()).toEqual(styleBefore);
    } else assign();
    await document.save(sink);
  } else if (route === "model-batch") {
    const apply = () => api.applyStyleModelBatch(input, batch, textContext);
    if (assignment.invalid) await expect(apply()).rejects.toMatchObject({ code: "usage" });
    else await (await apply()).save(sink);
  } else if (route === "ordered-sdk") {
    let published = 0;
    const apply = () => api.executeDocumentBatch(input, batch, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { published++; await sink.write(bytes); } } });
    if (assignment.invalid) { await expect(apply()).rejects.toMatchObject({ code: "usage" }); expect(published).toBe(0); }
    else await apply();
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retain destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(batch)}' --output /destination --force --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(assignment.invalid ? 2 : 0);
      if (assignment.invalid) { expect(JSON.parse(result.stdout).errors[0].code).toBe("usage"); expect(new TextDecoder().decode(await fs.readFile("/destination"))).toBe("Retain destination"); }
      else memory.writeFileSync("/output", await fs.readFile("/destination"));
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  if (assignment.invalid && route !== "model") expect(memory.readFileSync("/output").length).toBe(0);
  else {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
    if (assignment.invalid) expect(saved).toEqual(parts);
    else {
      for (const [name, bytes] of parts) if (name !== (owner === "style" ? "word/styles.xml" : "word/document.xml")) expect(saved.get(name), name).toEqual(bytes);
      const document = await api.Document(output, textContext), format = owner === "style" ? (document.styles.at("Coast") as api.ParagraphStyle).paragraph_format : document.paragraphs[0]!.paragraph_format;
      const observed = format[assignment.member];
      if (assignment.value === null || typeof assignment.value === "number") expect(observed).toBe(assignment.value);
      else expect((observed as api.Length).emu).toBe(assignment.value.value * 12700);
      const dirtyXml = new TextDecoder().decode(saved.get(owner === "style" ? "word/styles.xml" : "word/document.xml"));
      expect(dirtyXml).toContain("<!--before-->"); expect(dirtyXml).toContain("<?retain owner?>");
      expect(document.paragraphs[0]!.text).toBe("Retain 日本 עברית é 🌊"); expect(document.paragraphs[0]!.runs[0]!.bold).toBe(true);
    }
  }
});
