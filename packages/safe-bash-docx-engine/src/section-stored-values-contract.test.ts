import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import type { SectionDirectProperties } from "./section-properties.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const lengths = [
  ["page_width", "pgSz", "w", "pageWidth"], ["page_height", "pgSz", "h", "pageHeight"],
  ["top_margin", "pgMar", "top", "topMargin"], ["bottom_margin", "pgMar", "bottom", "bottomMargin"],
  ["left_margin", "pgMar", "left", "leftMargin"], ["right_margin", "pgMar", "right", "rightMargin"],
  ["gutter", "pgMar", "gutter", "gutter"], ["header_distance", "pgMar", "header", "headerDistance"],
  ["footer_distance", "pgMar", "footer", "footerDistance"]
] as const;
const values = [
  { stored: "", expected: null }, { stored: "1e3", expected: null },
  { stored: "0x10", expected: null }, { stored: "1.0", expected: null },
  { stored: "&#xA0;1440", expected: null }, { stored: "9007199254740992", expected: null },
  { stored: "1440", expected: 1440 }, { stored: " &#x9;+01440&#xA; ", expected: 1440 },
  { stored: "-1440", expected: -1440 }
] as const;
const orientations = [
  { stored: "", expected: null }, { stored: "diagonal", expected: null },
  { stored: "LANDSCAPE", expected: null }, { stored: " landscape ", expected: null },
  { stored: "portrait", expected: "PORTRAIT" }, { stored: "landscape", expected: "LANDSCAPE" }
] as const;
const wrap = (xml: string, carrier: string) => carrier === "direct" ? xml : carrier === "process" ? `<f:pass>${xml}</f:pass>` :
  `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? xml : '<f:inactive stamp="exact"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? xml : '<f:inactive stamp="exact"/>'}</mc:Fallback></mc:AlternateContent>`;

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
for (const c of [
  ...lengths.flatMap(([member, tag, attribute, direct]) => values.map(v => ({ ...v, member, direct, xml: `<w:${tag} w:${attribute}="${v.stored}"/>` }))),
  ...orientations.map(v => ({ ...v, member: "orientation", direct: "orientation", xml: `<w:pgSz w:orient="${v.stored}"/>` }))
]) it(`section stored ${c.member}=${JSON.stringify(c.stored)}; ${kind}; strict=${strict}; ${carrier}`, async () => {
  const body = `<w:p><w:r><w:t>é 日本 עברית 🌊</w:t></w:r></w:p><w:sectPr xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass"><!--retain--><?policy keep?>${wrap(c.xml, carrier)}</w:sectPr>`;
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, body);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
  const document = await api.Document(input, textContext);
  const before = document.part.blob;
  const batch = { version: 1, operations: [
    { operation: "model.document.Document.sections.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "sections" },
    { operation: `model.section.Section.${c.member}.get`, receiver: { resultHandle: "sections", index: 0 }, arguments: {} }
  ] };
  const native = () => Reflect.get(document.sections[0]!, c.member) as unknown;
  const sdk = () => api.executeDocumentBatch(input, batch, {}, { ...textContext, encoding: { order: "input", compression: "store" } });
  const utility = () => api.inspectDocumentSections(input, {}, textContext);
  const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  const cli = async (args: string[]) => {
    volume.writeFileSync("/out", ""); volume.writeFileSync("/err", "");
    const result = await api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: args.map(value => new TextEncoder().encode(value)), cwd: "/", signal: textContext.signal,
      filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
      stdin: { async *[Symbol.asyncIterator]() {} }, stdout: sink,
      stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
    });
    const out = JSON.parse(volume.readFileSync("/out", "utf8") as string) as { ok: boolean; affected: number; errors: {code: string}[]; data: {results: {data: unknown}[]; items: {direct: Record<string, unknown>}[]} | null };
    return { result, out };
  };
  if (c.expected === null) {
    expect(native).toThrow(api.InvalidDocumentError);
    await expect(sdk()).rejects.toMatchObject({ code: "invalid-package" });
    if (c.member === "orientation") expect((await utility()).items[0]!.direct.orientation).toBe(c.stored);
    else await expect(utility()).rejects.toMatchObject({ code: "invalid-package" });
    for (const args of [["batch", "/input", "--ops-json", JSON.stringify(batch), "--json"], ["sections", "list", "/input", "--json"]]) {
      const {result, out} = await cli(args);
      if (args[0] === "sections" && c.member === "orientation") {
        expect(result.exitCode).toBe(0); expect(out.affected).toBe(0); expect(out.data!.items[0]!.direct.orientation).toBe(c.stored);
      } else { expect(result.exitCode).toBe(1); expect(out).toMatchObject({ok: false, affected: 0, data: null, errors: [{code: "invalid-package"}]}); }
    }
  } else {
    const v = native() as { twips?: number; name?: string };
    expect(typeof c.expected === "number" ? v.twips : v.name).toBe(c.expected);
    const result = await sdk();
    const data = result.results[1]!.data as {value?: number; name?: string};
    expect(typeof c.expected === "number" ? data.value : data.name).toBe(typeof c.expected === "number" ? c.expected * 635 : c.expected);
    expect((await utility()).items[0]!.direct[c.direct as keyof SectionDirectProperties]).toBe(typeof c.expected === "number" ? c.expected : c.expected.toLowerCase());
    for (const args of [["batch", "/input", "--ops-json", JSON.stringify(batch), "--json"], ["sections", "list", "/input", "--json"]]) {
      const {result, out} = await cli(args); expect(result.exitCode).toBe(0); expect(out.affected).toBe(0);
      if (args[0] === "batch") expect(out.data!.results[1]!.data).toEqual(typeof c.expected === "number" ? { value: c.expected * 635, unit: "emu" } : { enum: "WD_ORIENTATION", name: c.expected });
      else expect(out.data!.items[0]!.direct[c.direct]).toBe(typeof c.expected === "number" ? c.expected : c.expected.toLowerCase());
    }
  }
  expect(document.part.blob).toEqual(before);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  expect(document.paragraphs[0]!.text).toBe("é 日本 עברית 🌊");
  volume.writeFileSync("/out", ""); await document.save(sink);
  expect(readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer))).toEqual(readPackage(input));
});
