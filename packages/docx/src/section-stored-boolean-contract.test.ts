import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, Twips, createDocxInspectionCommandEngine, editDocumentSections, executeDocumentBatch, inspectDocumentSections, readArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

const enc = (value: string) => new TextEncoder().encode(value);
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const flags = [
  { value: " true ", expected: true }, { value: "&#x9;1&#xA;", expected: true },
  { value: " false ", expected: false }, { value: "&#xD;0&#x9;", expected: false },
  { value: "on", expected: true }, { value: "off", expected: false }
] as const;
const carriers = ["direct", "choice", "fallback", "process"] as const;

for (const strict of [false, true]) for (const carrier of carriers)
for (const route of ["model", "sdk", "cli"] as const) it.each(flags)(
  `F16 stored flag $value preserves definitions and geometry; ${carrier} ${route} strict=${strict}`,
  async ({ value, expected }) => {
    const selected = `<w:titlePg w:val="${value}"/>`;
    const title = carrier === "direct" ? selected : carrier === "process" ? `<f:pass>${selected}</f:pass>` :
      `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? selected : '<f:inactive stamp="untouched"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? selected : '<f:inactive stamp="untouched"/>'}</mc:Fallback></mc:AlternateContent>`;
    const body = `<w:p><w:r><w:t>海 é</w:t></w:r></w:p><w:sectPr xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass"><!--keep--><?original keep?><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="720" w:footer="720"/><w:cols w:num="1" w:space="720" w:equalWidth=" true " w:sep="${value}"/>${title}</w:sectPr>`;
    const input = await textFixture(body, {}, strict), volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
    const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
    const batch = { version: 1, operations: [
      { operation: "model.document.Document.sections.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "sections" },
      { operation: "model.section.Section.different_first_page_header_footer.get", receiver: { resultHandle: "sections", index: 0 }, arguments: {} },
      { operation: "model.section.Section.header_distance.set", receiver: { resultHandle: "sections", index: 0 }, arguments: { value: { value: 900, unit: "twip" } } }
    ] };
    if (route === "model") {
      const doc = await Document(input, textContext);
      expect(doc.sections[0]!.different_first_page_header_footer).toBe(expected);
      doc.sections[0]!.header_distance = Twips(900); await doc.save(sink);
    } else if (route === "sdk") {
      expect((await inspectDocumentSections(input, {}, textContext)).items[0]!.direct).toMatchObject({ differentFirstPage: expected, columnSeparator: expected, equalWidth: true });
      const result = await executeDocumentBatch(input, batch, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
      expect(result.results[1]!.data).toBe(expected);
    } else {
      const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: ["batch", "/input", "--ops-json", JSON.stringify(batch), "--output", "-"].map(enc), cwd: "/", signal: textContext.signal,
        filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: sink,
        stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
    }
    const output = new Uint8Array(volume.readFileSync("/out") as Buffer);
    const direct = (await inspectDocumentSections(output, {}, textContext)).items[0]!.direct;
    expect(direct).toMatchObject({ headerDistance: 900, pageWidth: 12240, pageHeight: 15840, differentFirstPage: expected, columnSeparator: expected, equalWidth: true });
    const before = await readArchive(input, textContext), after = await readArchive(output, textContext);
    const omitMargin = (xml: string) => {
      const start = xml.indexOf("<w:pgMar"), end = xml.indexOf("</w:pgMar>", start);
      return xml.slice(0, start) + xml.slice(end >= 0 ? end + "</w:pgMar>".length : xml.indexOf("/>", start) + 2);
    };
    for (const member of before.members) {
      const saved = after.members.find(item => item.name === member.name)!.bytes;
      if (member.name === "word/document.xml") expect(omitMargin(new TextDecoder().decode(saved))).toBe(omitMargin(new TextDecoder().decode(member.bytes)));
      else expect(saved).toEqual(member.bytes);
    }
    expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  }
);

for (const strict of [false, true]) it.each([" on ", " off ", "TRUE", "&#xA0;true", "tr ue", "2"])(
  `F16 malformed stored flag %s rejects without publication strict=${strict}`,
  async value => {
    const input = await textFixture(`<w:sectPr><w:titlePg w:val="${value}"/></w:sectPr>`, {}, strict);
    const volume = Volume.fromJSON({ "/out": "" });
    await expect(editDocumentSections(input, { operation: "sections.set", options: { section: 1, differentFirstPage: true, output: "-" } }, {
      ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }
    })).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(volume.readFileSync("/out", "utf8")).toBe("");
  }
);
