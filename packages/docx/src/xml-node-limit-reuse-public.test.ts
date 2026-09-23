import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const staged of [false, true]) for (const asynchronous of [false, true])
it(`owned XML reuses an exactly fitting narrowed element ceiling with full parser reservations; strict=${strict}; kind=${kind}; staged=${staged}; asynchronous=${asynchronous}`, async () => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const input = await textFixture("<w:p/>", { styles: { kind: "styles", xml: `<w:styles xmlns:w="${word}" xmlns:f="urn:original:node-limit-reuse" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><f:opaque>${"<f:leaf/>".repeat(1024)}</f:opaque></w:styles>` } }, strict, { kind });
  const budget = new api.DocumentBudget(), context = { ...textContext, budget };
  const document = await api.Document(input, context);
  if (staged) document.styles.element.insert(1, { kind: "element", name: { namespaceURI: word, localName: "style" }, attributes: [{ name: { namespaceURI: word, localName: "styleId" }, value: "Owned" }, { name: { namespaceURI: word, localName: "type" }, value: "character" }] });
  const volume = Volume.fromJSON({ "/source": "" });
  volume.writeFileSync("/source", document.styles.element.serialize());
  const source = new Uint8Array(volume.readFileSync("/source") as Buffer), original = source.slice();
  const first = api.parseDocumentXml(source, {}, budget), count = staged ? 1027 : 1026;
  const before = budget.usage;
  const second = asynchronous ? await api.parseDocumentXmlAsync(source.slice(), { maxNodes: count }, budget) : api.parseDocumentXml(source.slice(), { maxNodes: count }, budget);
  expect(second.root).toBe(first.root);
  expect(budget.usage.xmlNodes - before.xmlNodes).toBeGreaterThanOrEqual(count);
  expect(budget.usage.retainedBytes - before.retainedBytes).toBeGreaterThanOrEqual(source.length * 16);
  expect(budget.usage.work - before.work).toBeGreaterThanOrEqual(source.length);
  expect(() => api.parseDocumentXml(source.slice(), { maxNodes: count - 1 }, budget)).toThrow(api.ResourceLimitError);
  expect(() => api.parseDocumentXml(source.slice(), { maxDepth: 1 }, budget)).toThrow(api.ResourceLimitError);
  expect(() => api.parseDocumentXml(source.slice(), { maxNodes: count }, budget.lower({ xmlNodes: budget.usage.xmlNodes }))).toThrow(api.ResourceLimitError);
  const changed = new TextEncoder().encode(new TextDecoder().decode(source).replace("f:leaf", "f:twig"));
  const changedResult = api.parseDocumentXml(changed, { maxNodes: count }, budget);
  expect(changedResult.root).not.toBe(first.root);
  expect(Buffer.compare(Buffer.from(source), Buffer.from(original))).toBe(0);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const asynchronous of [false, true])
it(`different element ceilings replay only parser reservations, excluding host scheduler costs; strict=${strict}; kind=${kind}; asynchronous=${asynchronous}`, async () => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const input = await textFixture("<w:p/>", { styles: { kind: "styles", xml: `<w:styles xmlns:w="${word}" xmlns:f="urn:original:host-reservation" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><f:opaque>${"<f:leaf/>".repeat(1024)}</f:opaque></w:styles>` } }, strict, { kind });
  let armed = true, hostNodes = 0;
  const budget = new api.DocumentBudget({}, textContext.signal, async () => {
    if (!armed) return;
    hostNodes++;
    budget.charge("xmlNodes", 1);
    budget.charge("retainedBytes", 13);
    budget.charge("work", 17);
  });
  const document = await api.Document(input, { ...textContext, budget });
  const volume = Volume.fromJSON({ "/source": "" });
  volume.writeFileSync("/source", document.styles.element.serialize());
  const bytes = new Uint8Array(volume.readFileSync("/source") as Buffer), original = bytes.slice();
  expect(hostNodes).toBeGreaterThan(0);
  armed = false;
  const control = new api.DocumentBudget();
  api.parseDocumentXml(bytes, { maxNodes: 1026 }, control);
  const before = budget.usage;
  const parsed = asynchronous ? await api.parseDocumentXmlAsync(bytes.slice(), { maxNodes: 1026 }, budget) : api.parseDocumentXml(bytes.slice(), { maxNodes: 1026 }, budget);
  expect(parsed.root.namespace).toBe(word);
  expect(budget.usage.xmlNodes - before.xmlNodes).toBe(control.usage.xmlNodes);
  expect(budget.usage.retainedBytes - before.retainedBytes).toBe(control.usage.retainedBytes);
  expect(budget.usage.work - before.work).toBe(control.usage.work + bytes.length * 3);
  expect(Buffer.compare(Buffer.from(bytes), Buffer.from(original))).toBe(0);
});
