import { Volume } from "memfs";
import assert from "node:assert/strict";
import { Document, DocumentBudget, writeArchive } from "../../src/index.js";
import { readPackage } from "../assertions.js";
import { textContext, textFixture, w, r } from "./text.js";

const limits = { ...textContext.limits, maxArchiveBytes: 1048576, maxEntryBytes: 524288,
  maxTotalBytes: 1048576, maxRetainedBytes: 1073741824 };
const context = () => ({ ...textContext, limits,
  budget: new DocumentBudget({ xmlDepth: 16384, work: 1073741824, retainedBytes: 1073741824 }) });

export async function exerciseStoryRelink({ strict, kind, story, variant, shared, depth }: {
  strict: boolean; kind: "docx" | "dotx"; story: "header" | "footer";
  variant: "default" | "first" | "even"; shared: boolean; depth: number;
}) {
  const namespace = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const relationships = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r;
  const storyXml = `<w:${story === "header" ? "hdr" : "ftr"} xmlns:w="${w}"><w:p><w:r><w:t>日本 עברית é 🌊</w:t></w:r></w:p></w:${story === "header" ? "hdr" : "ftr"}>`;
  const parts = readPackage(await textFixture("<w:sectPr/>", { [story]: { kind: story, xml: storyXml } }, strict, { kind }));
  const inert = '<f:x>'.repeat(depth) + `<f:leaf${shared ? ` r:id="${story}"` : ""}/>` + '</f:x>'.repeat(depth);
  const boundary = '<w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:t>Boundary</w:t></w:r></w:p>';
  const section = `<w:sectPr><w:${story}Reference w:type="${variant}" r:id="${story}"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>`;
  parts.set("word/document.xml", new TextEncoder().encode(`<w:document xmlns:w="${namespace}" xmlns:r="${relationships}" xmlns:f="urn:original:relink-depth" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:body>${boundary}${inert}<!--retain--><?audit exact?>${section}</w:body></w:document>`));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) },
    { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, context());
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const document = await Document(input, context());
  const member = variant === "default" ? story : variant === "first" ? `first_page_${story}` : `even_page_${story}`;
  const owner = document.sections[1]![member as "header" | "footer" | "first_page_header" | "first_page_footer" | "even_page_header" | "even_page_footer"];
  assert.equal(owner.is_linked_to_previous, false);
  owner.is_linked_to_previous = true;
  assert.equal(owner.is_linked_to_previous, true);
  await document.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  const after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
  assert.equal(new TextDecoder().decode(after.get("word/document.xml")), new TextDecoder().decode(parts.get("word/document.xml")).replace(`<w:${story}Reference w:type="${variant}" r:id="${story}"/>`, ""));
  for (const [name, bytes] of parts) {
    if (name === "word/document.xml") continue;
    if (shared || !["[Content_Types].xml", "word/_rels/document.xml.rels", `word/${story}.xml`].includes(name)) assert.deepEqual(after.get(name), bytes, name);
  }
  assert.equal(after.has(`word/${story}.xml`), shared);
  assert.ok(new TextDecoder().decode(after.get("word/_rels/document.xml.rels")).includes(shared ? `Id="${story}"` : "<Relationships"));
  if (!shared) assert.ok(!new TextDecoder().decode(after.get("word/_rels/document.xml.rels")).includes(`Id="${story}"`));
  assert.deepEqual(memory.readFileSync("/input"), Buffer.from(input));
}
