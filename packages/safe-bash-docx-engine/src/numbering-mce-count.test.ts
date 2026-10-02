import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, DocumentBudget, SemanticValidationError, applyStyleModelBatch, createDocxInspectionCommandEngine, readArchive, type DocxBatchOperation } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const num = (id: number) => `<w:num w:numId="${id}"><w:abstractNumId w:val="0"/></w:num>`;
const alternate = (selected: string, fallback: string, requires = "w") => `<mc:AlternateContent><mc:Choice Requires="${requires}">${selected}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`;
const fixtures = ["direct", "choice", "fallback", "process", "ignored", "empty selection"] as const;
async function inputFor(fixture: typeof fixtures[number], strict: boolean) {
  const instance = fixture === "choice" ? alternate(num(1), num(2) + num(3))
    : fixture === "fallback" ? alternate(num(2) + num(3), num(1), "f")
    : fixture === "process" ? `<f:pass>${num(1)}</f:pass>`
    : fixture === "ignored" ? num(1) + `<f:opaque>${num(2)}${num(3)}</f:opaque>`
    : fixture === "empty selection" ? alternate("", num(2) + num(3)) : num(1);
  return textFixture("<w:p/>", { numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}" xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1"/></w:lvl></w:abstractNum>${instance}</w:numbering>` } }, strict);
}
const operations: readonly DocxBatchOperation[] = [
  { operation: "model.document.Document.part.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "main" },
  { operation: "model.parts.document.DocumentPart.numbering_part.get", receiver: { resultHandle: "main" }, arguments: {}, resultHandle: "numbering" },
  { operation: "model.parts.numbering.NumberingPart.numbering_definitions.get", receiver: { resultHandle: "numbering" }, arguments: {}, resultHandle: "definitions" },
  { operation: "model.NumberingDefinitionsView.length.get", receiver: { resultHandle: "definitions" }, arguments: {} }
];

for (const strict of [false, true]) for (const route of ["model", "sdk", "cli"] as const) it.each(fixtures)(
  `${strict ? "Strict" : "Transitional"} ${route} counts only active concrete definitions: %s`, async fixture => {
    const input = await inputFor(fixture, strict), expected = fixture === "empty selection" ? 0 : 1;
    if (route === "model") {
      const doc = await Document(input, textContext), part = doc.part.numbering_part;
      const before = part.element.serialize();
      expect(part.numbering_definitions.length).toBe(expected);
      expect(part.element.serialize()).toEqual(before);
      if (fixture === "choice") expect(part.element.children.some(node => node.localName === "AlternateContent")).toBe(true);
      const volume = Volume.fromJSON({ "/saved": "" });
      await doc.save({ async write(bytes) { volume.appendFileSync("/saved", bytes); } });
      const saved = new Uint8Array(volume.readFileSync("/saved") as Buffer);
      const original = await readArchive(input, textContext), reopened = await readArchive(saved, textContext);
      expect(reopened.members.map(member => [member.name, member.bytes])).toEqual(original.members.map(member => [member.name, member.bytes]));
      expect((await Document(saved, textContext)).part.numbering_part.numbering_definitions.length).toBe(expected);
    } else if (route === "sdk") {
      const result = await applyStyleModelBatch(input, { version: 1, operations }, textContext);
      expect(result.affected).toBe(0);
      expect(result.results.at(-1)?.value).toBe(expected);
    } else {
      const volume = Volume.fromJSON({ "/in.docx": Buffer.from(input), "/out": "", "/err": "" });
      const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: ["batch", "/in.docx", "--ops-json", JSON.stringify({ version: 1, operations }), "--dry-run", "--json"].map(word => new TextEncoder().encode(word)),
        cwd: "/", signal: textContext.signal,
        filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
      const envelope = JSON.parse(volume.readFileSync("/out", "utf8") as string);
      expect(envelope.affected).toBe(0);
      expect(envelope.data.results.at(-1).data).toBe(expected);
      expect(volume.readFileSync("/in.docx")).toEqual(Buffer.from(input));
      expect(volume.readdirSync("/")).toEqual(["err", "in.docx", "out"]);
    }
  }
);

it("keeps repeated numbering collection and count reads bounded and cancellable", async () => {
  const controller = new AbortController(), budget = new DocumentBudget({ retainedBytes: 4 * 1024 * 1024 }, controller.signal);
  const doc = await Document(await inputFor("direct", false), { ...textContext, signal: controller.signal, budget });
  const part = doc.part.numbering_part, collection = part.numbering_definitions;
  expect(collection.length).toBe(1);
  const before = budget.usage;
  for (let i = 0; i < 20; i++) { expect(part.numbering_definitions).toBe(collection); expect(collection.length).toBe(1); }
  expect(budget.usage.retainedBytes).toBe(before.retainedBytes);
  expect(budget.usage.work).toBeGreaterThan(before.work);
  controller.abort();
  expect(() => collection.length).toThrow("cancelled");
});

for (const strict of [false, true]) it(`retains counts across ordinary edits, rename and rejected mutation; strict=${strict}`, async () => {
  const input = await inputFor("choice", strict), doc = await Document(input, textContext), other = await Document(input, textContext);
  const part = doc.part.numbering_part, collection = part.numbering_definitions, namespaceURI = part.element.namespace;
  expect(collection.length).toBe(1);
  const added = part.element.insert(part.element.children.length, { kind: "element", name: { namespaceURI, localName: "num" }, attributes: [{ name: { namespaceURI, localName: "numId" }, value: "7" }], children: [
    { kind: "element", name: { namespaceURI, localName: "abstractNumId" }, attributes: [{ name: { namespaceURI, localName: "val" }, value: "0" }], children: [] }
  ] });
  expect(collection.length).toBe(2);
  expect(other.part.numbering_part.numbering_definitions.length).toBe(1);
  const before = part.blob;
  expect(() => added.set_attribute({ namespaceURI, localName: "numId" }, "1")).toThrow(SemanticValidationError);
  expect(part.blob).toEqual(before);
  expect(collection.length).toBe(2);
  added.remove();
  expect(collection.length).toBe(1);
  part.partname = "/word/renamed-numbering.xml";
  expect(collection.length).toBe(1);
  expect(doc.part.numbering_part).toBe(part);
  expect(part.numbering_definitions).toBe(collection);
});
