import { expect, it, vi } from "vitest";
import { DocumentSession } from "./document-session.js";
import { archiveSettings } from "./archive.js";
import { readDocumentArchive } from "./admission.js";
import { publishDocumentArchive } from "./publication.js";
import { DocumentBudget } from "./budget.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

it("keeps ordered edits unpublished and decompresses the source only once", async () => {
  const input = await textFixture('<w:p><w:r><w:t>First</w:t></w:r></w:p>');
  const budget = new DocumentBudget({}, textContext.signal);
  const stdout = { write: vi.fn() };
  const context = { ...textContext, budget, stdout, encoding: { order: "name", compression: "store" } as const };
  const session = await DocumentSession.open(input, context);
  const original = await readDocumentArchive(input, archiveSettings(session.context));
  const changed = { ...original, members: original.members.map(member => member.name === "word/document.xml" ? { ...member, bytes: new TextEncoder().encode(new TextDecoder().decode(member.bytes).replace("First", "Second")) } : member) };
  await expect(publishDocumentArchive(changed, { output: "-" }, session.context)).resolves.toEqual({ published: [] });
  const current = await readDocumentArchive(input, archiveSettings(session.context));
  expect(new TextDecoder().decode(current.members.find(member => member.name === "word/document.xml")!.bytes)).toContain("Second");
  expect(new TextDecoder().decode(session.baseline.members.find(member => member.name === "word/document.xml")!.bytes)).toContain("First");
  expect(budget.usage.compressedInput).toBe(input.length);
  expect(budget.usage.serializedOutput).toBe(0);
  expect(stdout.write).not.toHaveBeenCalled();
  expect(await session.snapshot()).toBe(current);
});

it("refuses a different input source inside a staged session", async () => {
  const input = await textFixture('<w:p/>');
  const session = await DocumentSession.open(input, { ...textContext, encoding: { order: "name", compression: "store" } });
  await expect(readDocumentArchive(new Uint8Array([1, 2, 3]), session.context)).rejects.toThrow("session source");
});

it("admits byte-identical utility snapshots without a second decompression", async () => {
  const input = await textFixture('<w:p/>');
  const budget = new DocumentBudget({}, textContext.signal);
  const session = await DocumentSession.open(input, { ...textContext, budget, encoding: { order: "name", compression: "store" } });
  expect(await readDocumentArchive(new Uint8Array(input), session.context)).toBe(session.baseline);
  expect(budget.usage.compressedInput).toBe(input.length);
});

it("rejects earlier location tokens after a staged revision", async () => {
  const { openDocumentLocations } = await import("./locations.js");
  const input = await textFixture('<w:p><w:r><w:t>First</w:t></w:r></w:p>');
  const budget = new DocumentBudget({}, textContext.signal);
  const session = await DocumentSession.open(input, { ...textContext, budget, encoding: { order: "name", compression: "store" } });
  const view = await openDocumentLocations(input, session.context);
  const token = view.list("paragraph")[0]!.token;
  await session.stage({ ...session.baseline, members: session.baseline.members.map(member => member.name === "word/document.xml" ? { ...member, bytes: new TextEncoder().encode(new TextDecoder().decode(member.bytes).replace("First", "Second")) } : member) });
  const current = await openDocumentLocations(input, session.context);
  expect(() => current.resolve(token)).toThrow("The document location is stale.");
  expect(budget.usage.compressedInput).toBe(input.length);
});

it("reuses unchanged XML parses across session budget views and rechecks stricter limits", async () => {
  const { parseDocumentXml, parseDocumentXmlAsync } = await import("./package-xml.js");
  const input = await textFixture('<w:p><w:r><w:t>First</w:t></w:r></w:p>');
  const budget = new DocumentBudget({}, textContext.signal);
  const session = await DocumentSession.open(input, { ...textContext, budget, encoding: { order: "name", compression: "store" } });
  const bytes = session.baseline.members.find(member => member.name === "word/document.xml")!.bytes;
  const first = parseDocumentXml(bytes, {}, budget);
  const nodes = budget.usage.xmlNodes;
  expect(await parseDocumentXmlAsync(bytes, {}, budget.lower({}))).toBe(first);
  expect(parseDocumentXml(new Uint8Array(bytes), {}, budget)).toBe(first);
  expect(budget.usage.xmlNodes).toBe(nodes);
  expect(() => parseDocumentXml(bytes, { maxDepth: 1 }, budget)).toThrow("limit");
  const changed = new TextEncoder().encode(new TextDecoder().decode(bytes).replace("First", "Second"));
  expect(parseDocumentXml(changed, {}, budget)).not.toBe(first);
});

it("charges repeated edit fragments independently from admitted package XML", async () => {
  const { parseDocumentXml } = await import("./package-xml.js");
  const input = await textFixture('<w:p/>');
  const budget = new DocumentBudget({}, textContext.signal);
  await DocumentSession.open(input, { ...textContext, budget, encoding: { order: "name", compression: "store" } });
  const fragment = new TextEncoder().encode('<fragment><entry>Insert twice</entry></fragment>');
  parseDocumentXml(fragment, {}, budget);
  const before = budget.usage.xmlNodes;
  parseDocumentXml(new Uint8Array(fragment), {}, budget);
  expect(budget.usage.xmlNodes - before).toBeGreaterThan(0);
});
