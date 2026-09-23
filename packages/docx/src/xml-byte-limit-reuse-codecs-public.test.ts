import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["UTF-16LE", "UTF-16BE"] as const)
for (const staged of [false, true]) for (const asynchronous of [false, true])
it(`owned whole-package XML codecs retain byte-ceiling admission and complete replay reservations; codec=${codec}; strict=${strict}; kind=${kind}; staged=${staged}; asynchronous=${asynchronous}`, async () => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const fixture = await textFixture("<w:p/>", { styles: { kind: "styles", xml: `<w:styles xmlns:w="${word}" xmlns:f="urn:original:byte-limit-reuse" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><f:opaque>${"<f:leaf/>".repeat(1024)}</f:opaque></w:styles>` } }, strict, { kind });
  const encodeXml = (text: string): Uint8Array => {
    const bytes = Buffer.from("\ufeff" + text, "utf16le");
    if (codec === "UTF-16BE") bytes.swap16();
    return new Uint8Array(bytes);
  };
  const archive = await api.readArchive(fixture, textContext), packageMemory = Volume.fromJSON({ "/input": "" });
  await api.writeArchive({ ...archive, members: archive.members.map(member => ({ ...member, bytes: encodeXml(new TextDecoder().decode(member.bytes)) })) }, { async write(bytes) { packageMemory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(packageMemory.readFileSync("/input") as Buffer);
  const budget = new api.DocumentBudget(), document = await api.Document(input, { ...textContext, budget });
  if (staged) document.styles.element.insert(1, { kind: "element", name: { namespaceURI: word, localName: "style" }, attributes: [{ name: { namespaceURI: word, localName: "styleId" }, value: "Owned" }, { name: { namespaceURI: word, localName: "type" }, value: "character" }] });
  const memory = Volume.fromJSON({ "/source": "" });
  memory.writeFileSync("/source", document.styles.part.blob);
  const source = new Uint8Array(memory.readFileSync("/source") as Buffer), original = source.slice();
  expect([...source.subarray(0, 2)]).toEqual(codec === "UTF-16LE" ? [255, 254] : [254, 255]);
  const first = api.parseDocumentXml(source, {}, budget), count = staged ? 1027 : 1026, before = budget.usage;
  const second = asynchronous ? await api.parseDocumentXmlAsync(source.slice(), { maxBytes: source.length }, budget) : api.parseDocumentXml(source.slice(), { maxBytes: source.length }, budget);
  expect(second.root).toBe(first.root);
  expect(budget.usage.xmlNodes - before.xmlNodes).toBeGreaterThanOrEqual(count);
  expect(budget.usage.retainedBytes - before.retainedBytes).toBeGreaterThanOrEqual(source.length * 16);
  expect(budget.usage.work - before.work).toBeGreaterThanOrEqual(source.length);
  const refused = { maxBytes: source.length - 1 };
  if (asynchronous) await expect(api.parseDocumentXmlAsync(source.slice(), refused, budget)).rejects.toThrow(api.ResourceLimitError);
  else expect(() => api.parseDocumentXml(source.slice(), refused, budget)).toThrow(api.ResourceLimitError);
  expect(() => api.parseDocumentXml(source.slice(), { maxBytes: source.length, maxDepth: 1 }, budget)).toThrow(api.ResourceLimitError);
  expect(() => api.parseDocumentXml(source.slice(), { maxBytes: source.length, maxNodes: count - 1 }, budget)).toThrow(api.ResourceLimitError);
  expect(() => api.parseDocumentXml(source.slice(), { maxBytes: source.length }, budget.lower({ xmlNodes: budget.usage.xmlNodes }))).toThrow(api.ResourceLimitError);
  expect(() => api.parseDocumentXml(source.slice(), { maxBytes: source.length }, budget.lower({ retainedBytes: budget.usage.retainedBytes }))).toThrow(api.ResourceLimitError);
  expect(() => api.parseDocumentXml(source.slice(), { maxBytes: source.length }, budget.lower({ work: budget.usage.work }))).toThrow(api.ResourceLimitError);
  const changed = encodeXml(new TextDecoder(codec).decode(source).replace("f:leaf", "f:twig"));
  expect(api.parseDocumentXml(changed, { maxBytes: changed.length }, budget).root).not.toBe(first.root);
  expect(Buffer.compare(Buffer.from(source), Buffer.from(original))).toBe(0);
});
