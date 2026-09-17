import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, createDocxInspectionCommandEngine, inspectDocument, readArchive, readDocumentArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const alternate = (requires: string, inner = "", fallback?: string) => `<mc:AlternateContent xmlns:mc="${mc}" xmlns:f="urn:original:future"><mc:Choice Requires="${requires}">${inner}</mc:Choice>${fallback === undefined ? "" : `<mc:Fallback>${fallback}</mc:Fallback>`}</mc:AlternateContent>`;
const rejected = [
  { name: "unknown namespace", xml: alternate("f") },
  { name: "mixed requirements", xml: alternate("w f") },
  { name: "nested active unmatched alternative", xml: alternate("w", alternate("f")) }
];

for (const strict of [false, true]) for (const part of ["main", "styles", "header"] as const) for (const route of ["model", "archive", "sdk", "cli"] as const) it.each(rejected)(
  `${strict ? "Strict" : "Transitional"} ${route} rejects $name in ${part}`,
  async ({ xml }) => {
    const input = await textFixture(part === "main" ? xml : '<w:p/>', part === "main" ? {} : {
      [part]: { kind: part, xml: `<w:${part === "header" ? "hdr" : "styles"} xmlns:w="${w}">${xml}</w:${part === "header" ? "hdr" : "styles"}>` }
    }, strict);
    if (route === "model") await expect(Document(input, textContext)).rejects.toMatchObject({ code: "unsupported-profile" });
    else if (route === "archive") await expect(readDocumentArchive(input, textContext)).rejects.toMatchObject({ code: "unsupported-profile" });
    else if (route === "sdk") await expect(inspectDocument(input, textContext)).rejects.toMatchObject({ code: "unsupported-profile" });
    else {
      const volume = Volume.fromJSON({ "/out": "", "/err": "", "/input.docx": Buffer.from(input) });
      const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: ["inspect", "/input.docx"].map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
        filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(result.exitCode).toBe(1);
      expect(volume.readFileSync("/err", "utf8")).toContain("unsupported-profile");
      expect(volume.readFileSync("/out")).toHaveLength(0);
      expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
    }
  }
);

for (const strict of [false, true]) it.each([
  { name: "eligible empty choice", xml: alternate("w") },
  { name: "eligible empty fallback", xml: alternate("f", "", "") },
  { name: "unmatched alternative in an inactive choice", xml: alternate("f", alternate("f"), "") },
  { name: "unmatched alternative in an ignored wrapper", xml: `<f:skip xmlns:f="urn:original:future" xmlns:mc="${mc}" mc:Ignorable="f">${alternate("f")}</f:skip>` }
])(`preserves ${strict ? "Strict" : "Transitional"} $name`, async ({ xml }) => {
  const input = await textFixture(xml + '<w:p><w:r><w:t>Original</w:t></w:r></w:p>', {}, strict);
  const doc = await Document(input, textContext);
  expect(doc.paragraphs.map(paragraph => paragraph.text)).toEqual(["Original"]);
  expect((await inspectDocument(input, textContext)).counts).toMatchObject({ paragraphs: 1, runs: 1 });
  const volume = Volume.fromJSON({ "/out": "", "/cli": "", "/err": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["inspect", "/input.docx", "--json"].map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile() { return input; } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/cli", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
  });
  expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  expect(JSON.parse(volume.readFileSync("/cli", "utf8") as string)).toMatchObject({ affected: 0, data: { counts: { paragraphs: 1, runs: 1 } } });
  await doc.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
  const saved = new Uint8Array(volume.readFileSync("/out") as Buffer);
  expect((await Document(saved, textContext)).paragraphs.map(paragraph => paragraph.text)).toEqual(["Original"]);
  const before = await readArchive(input, textContext), after = await readArchive(saved, textContext);
  expect(after.members.map(member => [member.name, member.bytes])).toEqual(before.members.map(member => [member.name, member.bytes]));
});

for (const strict of [false, true]) it(`rolls back ${strict ? "Strict" : "Transitional"} XML insertion with an unmatched active alternative`, async () => {
  const input = await textFixture('<w:p xmlns:f="urn:original:future"><w:r><w:t>Original</w:t></w:r></w:p>', {}, strict);
  const doc = await Document(input, textContext), before = doc.element.serialize(), body = doc.paragraphs[0]!.element;
  expect(() => body.insert(0, { kind: "element", name: { namespaceURI: mc, localName: "AlternateContent" }, children: [
    { kind: "element", name: { namespaceURI: mc, localName: "Choice" }, attributes: [{ name: { namespaceURI: "", localName: "Requires" }, value: "f" }] }
  ] })).toThrowError(expect.objectContaining({ code: "unsupported-profile" }));
  expect(doc.element.serialize()).toEqual(before);
  expect(doc.paragraphs[0]!.text).toBe("Original");
});
