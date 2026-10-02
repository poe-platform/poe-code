import { expect, it } from "vitest";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

for (const strict of [false, true]) {
  it(`admitted XML reuse owns bytes and rechecks changed bytes and depth; strict=${strict}`, async () => {
    const input = await textFixture('<w:p><w:r><w:t>First</w:t></w:r></w:p>', {}, strict);
    const original = new Uint8Array(input);
    const budget = new api.DocumentBudget();
    const archive = await api.readDocumentArchive(input, { ...textContext, budget });
    const bytes = archive.members.find(member => member.name === "word/document.xml")!.bytes;
    const first = api.parseDocumentXml(bytes, {}, budget);
    const nodes = budget.usage.xmlNodes;
    expect(api.parseDocumentXml(new Uint8Array(bytes), {}, budget).root).toBe(first.root);
    expect(budget.usage.xmlNodes).toBe(nodes);
    const changed = new TextEncoder().encode(new TextDecoder().decode(bytes).replace("First", "Other"));
    expect(changed.length).toBe(bytes.length);
    bytes.set(changed);
    const second = api.parseDocumentXml(bytes, {}, budget);
    expect(second.root).not.toBe(first.root);
    expect(second.root.children[0]!.children[0]!.children[0]!.children[0]!.text).toBe("Other");
    expect(first.root.children[0]!.children[0]!.children[0]!.children[0]!.text).toBe("First");
    expect(() => api.parseDocumentXml(bytes, { maxDepth: 1 }, budget)).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
    expect(input).toEqual(original);
  });

  it(`admitted reuse never deduplicates new edit fragments; strict=${strict}`, async () => {
    const budget = new api.DocumentBudget();
    await api.readDocumentArchive(await textFixture('<w:p/>', {}, strict), { ...textContext, budget });
    const fragment = new TextEncoder().encode('<fragment><entry>Twice</entry></fragment>');
    api.parseDocumentXml(fragment, {}, budget);
    const before = budget.usage.xmlNodes;
    api.parseDocumentXml(new Uint8Array(fragment), {}, budget);
    expect(budget.usage.xmlNodes).toBeGreaterThan(before);
  });
}

for (const strict of [false, true])
  it(`public parse snapshots cannot poison a subsequent document read; strict=${strict}`, async () => {
    const input = await textFixture('<w:p><w:r><w:t>First</w:t></w:r></w:p>', {}, strict);
    const budget = new api.DocumentBudget();
    const context = { ...textContext, budget };
    const archive = await api.readDocumentArchive(input, context);
    const bytes = archive.members.find(member => member.name === "word/document.xml")!.bytes;
    const parsed = api.parseDocumentXml(bytes, {}, budget);
    const leaf = parsed.root.children[0]!.children[0]!.children[0]!.children[0]!;
    try { (leaf as { text: string }).text = "Other"; } catch { /* Read-only snapshots may refuse assignment. */ }
    try { (parsed.root.namespaces as Map<string, string>).set("w", "urn:original:changed"); } catch { /* Read-only namespace views may refuse assignment. */ }
    expect((await api.extractDocumentText(input, context, {})).text).toBe("First");
    expect(input).toEqual(await textFixture('<w:p><w:r><w:t>First</w:t></w:r></w:p>', {}, strict));
  });

for (const strict of [false, true])
  it(`detached public XML bytes cannot invalidate admitted reuse; strict=${strict}`, async () => {
    const input = await textFixture('<w:p><w:r><w:t>First</w:t></w:r></w:p>', {}, strict);
    const budget = new api.DocumentBudget(), context = { ...textContext, budget };
    const archive = await api.readDocumentArchive(input, context);
    const bytes = archive.members.find(member => member.name === "word/document.xml")!.bytes;
    const parsed = api.parseDocumentXml(bytes, {}, budget);
    const copied = structuredClone(parsed.bytes, { transfer: [parsed.bytes.buffer] });
    expect(parsed.bytes.length).toBe(0);
    expect(copied.length).toBe(bytes.length);
    expect((await api.extractDocumentText(input, context, {})).text).toBe("First");
  });
