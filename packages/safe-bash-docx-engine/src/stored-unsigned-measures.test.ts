import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
import { Volume } from "memfs";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const [attribute, property] of [["before", "space_before"], ["after", "space_after"], ["firstLine", "first_line_indent"], ["hanging", "first_line_indent"]] as const)
for (const raw of ["-1", "-1pt", "-0pt"])
for (const subject of ["paragraph", "style"] as const) for (const route of ["model", "sdk", "cli"] as const)
it(`rejects invalid unsigned stored ${attribute}=${raw}; ${subject}; ${route}; ${kind}; strict=${strict}`, async () => {
  const markup = attribute === "before" || attribute === "after" ? `<w:spacing w:${attribute}="${raw}"/>` : `<w:ind w:${attribute}="${raw}"/>`;
  let input: Uint8Array;
  if (subject === "paragraph") input = (await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p><w:pPr>${markup}</w:pPr><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>`)).input;
  else {
    const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Atlas"><w:name w:val="Atlas"/><w:pPr>${markup}</w:pPr></w:style></w:styles>` } }, strict));
    if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
    const memory = Volume.fromJSON({ "/input": "" });
    await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
    input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  }
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "format" },
    { operation: `model.text.parfmt.ParagraphFormat.${property}.get`, receiver: { resultHandle: "format" }, arguments: {} }
  ];
  if (route === "model") {
    const document = await api.Document(input, textContext), before = document.part.blob;
    const format = subject === "paragraph" ? document.paragraphs[0]!.paragraph_format : (document.styles.at("Atlas") as api.ParagraphStyle).paragraph_format;
    expect(() => format[property]).toThrow(api.InvalidDocumentError); expect(document.part.blob).toEqual(before);
  } else if (route === "sdk") {
    await expect(subject === "style" ? api.inspectDocumentStyles(input, {}, textContext) : api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).rejects.toMatchObject({ code: "invalid-package" });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", new TextEncoder().encode("Retain destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(subject === "style" ? "docx styles list /input --json" : `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --dry-run --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(JSON.parse(result.stdout).errors[0].code).toBe("invalid-package");
      expect(await fs.readFile("/input")).toEqual(input); expect(new TextDecoder().decode(await fs.readFile("/output"))).toBe("Retain destination");
    } finally { await shell.dispose(); }
  }
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const [raw, emu] of [["0", 0], ["+0", 0], ["-0", 0], ["12pt", 152400], ["1in", 914400], ["0.00005mm", 2], [" 24 ", 15240]] as const)
it(`reads valid unsigned measures ${JSON.stringify(raw)} and retains signed indentation; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p><w:pPr><w:spacing w:before="${raw}" w:after="${raw}"/><w:ind w:firstLine="${raw}" w:left="-12pt"/></w:pPr><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>`);
  const document = await api.Document(input, textContext), format = document.paragraphs[0]!.paragraph_format;
  expect(format.space_before?.emu === emu).toBe(true); expect(format.space_after?.emu === emu).toBe(true); expect(format.first_line_indent?.emu === emu).toBe(true); expect(format.left_indent?.emu).toBe(-152400);
  const memory = Volume.fromJSON({ "/out": "" });
  await document.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
  expect(readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer))).toEqual(readPackage(input));
});
