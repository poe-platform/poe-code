import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const boundary of ["cooperate", "cancel", "node-capacity", "changed-bytes"] as const)
it(`public asynchronous staged stylesheet parse retains ${boundary}; strict=${strict}; kind=${kind}`, async () => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const input = await textFixture("<w:p/>", { styles: { kind: "styles", xml: `<w:styles xmlns:w="${word}" xmlns:f="urn:original:staged-style" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><f:opaque>${"<f:leaf/>".repeat(1024)}</f:opaque></w:styles>` } }, strict, { kind });
  const original = input.slice(), controller = new AbortController();
  let armed = false, turns = 0;
  const budget = new api.DocumentBudget({}, controller.signal, async () => {
    if (!armed) return;
    turns++;
    if (boundary === "cancel") controller.abort();
  });
  const document = await api.Document(input, { ...textContext, signal: controller.signal, budget });
  document.styles.element.insert(1, { kind: "element", name: { namespaceURI: word, localName: "style" }, attributes: [
    { name: { namespaceURI: word, localName: "styleId" }, value: "OwnedStyle" },
    { name: { namespaceURI: word, localName: "type" }, value: "character" }
  ], children: [{ kind: "element", name: { namespaceURI: word, localName: "name" }, attributes: [{ name: { namespaceURI: word, localName: "val" }, value: "Owned Style" }] }] });
  const volume = Volume.fromJSON({ "/styles.xml": "" });
  volume.writeFileSync("/styles.xml", document.styles.element.serialize());
  const source = new Uint8Array(volume.readFileSync("/styles.xml") as Buffer), before = source.slice();
  const admitted = api.parseDocumentXml(source, {}, budget), nodes = budget.usage.xmlNodes;
  armed = true;
  if (boundary === "cancel") {
    await expect(api.parseDocumentXmlAsync(source.slice(), {}, budget)).rejects.toMatchObject({ code: "cancelled" });
    expect(turns).toBe(1);
  } else if (boundary === "cooperate") {
    const result = await api.parseDocumentXmlAsync(source.slice(), {}, budget);
    expect(turns).toBeGreaterThan(0);
    expect(budget.usage.xmlNodes - nodes).toBeGreaterThanOrEqual(1024);
    expect(result.root.namespace).toBe(word);
  } else if (boundary === "node-capacity") {
    await expect(api.parseDocumentXmlAsync(source.slice(), {}, budget.lower({ xmlNodes: nodes }))).rejects.toMatchObject({ code: "limit-exceeded" });
  } else {
    const changed = new TextEncoder().encode(new TextDecoder().decode(source).replace("OwnedStyle", "OtherStyle"));
    expect(changed.length).toBe(source.length);
    const result = await api.parseDocumentXmlAsync(changed, {}, budget);
    expect(result.root).not.toBe(admitted.root);
    expect(result.root.children[1]!.attributes.some(attribute => attribute.localName === "styleId" && attribute.value === "OtherStyle")).toBe(true);
    expect(admitted.root.children[1]!.attributes.some(attribute => attribute.localName === "styleId" && attribute.value === "OwnedStyle")).toBe(true);
  }
  expect(Buffer.compare(Buffer.from(source), Buffer.from(before))).toBe(0);
  expect(Buffer.compare(Buffer.from(input), Buffer.from(original))).toBe(0);
});
