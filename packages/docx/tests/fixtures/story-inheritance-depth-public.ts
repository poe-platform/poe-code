import assert from "node:assert/strict";
import { Volume } from "memfs";
import { Document, DocumentBudget, writeArchive } from "../../src/index.js";
import { readPackage } from "../assertions.js";
import { textContext, textFixture, w, r } from "./text.js";

export async function exerciseStoryInheritance(strict: boolean, count: number) {
  const limits = { ...textContext.limits, maxArchiveBytes: 1048576, maxEntryBytes: 524288,
    maxTotalBytes: 1048576, maxRetainedBytes: 1073741824 };
  const context = () => ({ ...textContext, limits,
    budget: new DocumentBudget({ xmlDepth: 16384, work: 1073741824, retainedBytes: 1073741824 }) });
  const namespace = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const relationships = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r;
  const parts = readPackage(await textFixture("<w:sectPr/>", { header: { kind: "header",
    xml: `<w:hdr xmlns:w="${w}"><w:p><w:r><w:t>Shared é 日本 עברית 🌊</w:t></w:r></w:p></w:hdr>` } }, strict));
  const binding = '<w:headerReference w:type="default" r:id="header"/>';
  const first = `<w:p><w:pPr><w:sectPr>${binding}</w:sectPr></w:pPr></w:p>`;
  const between = '<w:p><w:pPr><w:sectPr/></w:pPr></w:p>'.repeat(count - 2);
  parts.set("word/document.xml", new TextEncoder().encode(`<w:document xmlns:w="${namespace}" xmlns:r="${relationships}"><w:body>${first}${between}<w:sectPr/></w:body></w:document>`));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) },
    { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, context());
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const document = await Document(input, context());
  assert.equal(document.sections.length, count);
  const last = document.sections.at(-1).header;
  assert.equal(last.is_linked_to_previous, true);
  assert.equal(last.paragraphs[0]!.text, "Shared é 日本 עברית 🌊");
  assert.equal(last.part, document.sections[0]!.header.part);
  await document.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  const after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
  assert.equal(after.size, parts.size);
  for (const [name, bytes] of parts) assert.deepEqual(after.get(name), bytes, name);
  assert.deepEqual(memory.readFileSync("/input"), Buffer.from(input));
}
