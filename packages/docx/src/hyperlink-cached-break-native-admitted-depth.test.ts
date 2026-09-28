import { Volume } from "memfs";
import { beforeAll, expect, it } from "vitest";
import * as api from "./index.js";
import { archiveSettings, type DocumentArchive } from "./archive.js";
import { ModelStore } from "./model-store.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { mainThreadFixture } from "../tests/main-thread.js";

const executeNative = mainThreadFixture(new URL("../tests/fixtures/hyperlink-cached-break-native.mjs", import.meta.url));

let original: DocumentArchive;
beforeAll(async () => { original = await api.readArchive(await textFixture("<w:p/>"), textContext); });

for (const strict of [false, true]) for (const depth of [32, 4096, 8192])
for (const present of [false, true]) for (const host of ["worker", "main"] as const)
it(`queries admitted native hyperlink cached-break depth without host recursion; strict=${strict}; depth=${depth}; present=${present}; host=${host}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" :
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" :
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const body = `<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Before</w:t></w:r><w:hyperlink>${'<w:customXml w:element="original">'.repeat(depth)}` +
    `<w:r>${present ? "<w:lastRenderedPageBreak/>" : ""}</w:r>` + "</w:customXml>".repeat(depth) +
    "</w:hyperlink><w:r><w:t>After</w:t></w:r><!--retain--><?cached keep?></w:p>";
  const memory = Volume.fromJSON(Object.fromEntries(original.members.map(member => ["/" + member.name,
    Buffer.from(new TextDecoder().decode(member.bytes).split("http://schemas.openxmlformats.org/officeDocument/2006/relationships").join(r))])));
  memory.writeFileSync("/word/document.xml", `<w:document xmlns:w="${w}"><w:body>${body}</w:body></w:document>`);
  const members = original.members.map(member => ({ ...member, bytes: new Uint8Array(memory.readFileSync("/" + member.name) as Buffer) }));
  const context = { ...archiveSettings({ ...textContext, budget: new api.DocumentBudget({ xmlDepth: 16384,
    retainedBytes: 2 ** 30, work: 2 ** 30 }) }), author: "", initials: "" };
  const standaloneParagraph = body.replace("<w:p>", `<w:p xmlns:w="${w}">`);
  if (host === "worker") {
    // Exercise the real admitted model, XML and compatibility graph. Archive
    // acquisition/publication remain independently executed public obligations.
    const store = new ModelStore({ ...original, members }, context, "/word/document.xml");
    const node = store.xml(store.mainPart).root.children[0]!.children[0]!;
    const paragraph = new api.Paragraph(store, store.ref(store.mainPart, node));
    expect(paragraph.rendered_page_breaks).toHaveLength(present ? 1 : 0);
    expect(paragraph.hyperlinks[0]!.contains_page_break).toBe(present);
    expect(paragraph.text).toBe("BeforeAfter");
    expect(paragraph.paragraph_format.keep_with_next).toBe(true);
    expect(paragraph.runs[0]!.italic).toBe(true);
    expect(Buffer.from(paragraph.element.serialize()).equals(Buffer.from(standaloneParagraph))).toBe(true);
    const snapshot = store.snapshot();
    expect(snapshot.members.map(member => member.name).sort()).toEqual(members.map(member => member.name).sort());
    for (const member of snapshot.members) expect(Buffer.from(member.bytes).equals(memory.readFileSync("/" + member.name) as Buffer)).toBe(true);
  } else {
    const result = await executeNative({ members: members.map(member => ({ ...member,
      bytes: Buffer.from(member.bytes).toString("base64") })), limits: textContext.limits, body: standaloneParagraph });
    expect(JSON.parse(result)).toEqual({ ok: true, count: present ? 1 : 0, present,
      text: "BeforeAfter", keep: true, italic: true, exactParagraph: true, exactMembers: true });
  }
  for (const member of members) expect(Buffer.from(member.bytes).equals(memory.readFileSync("/" + member.name) as Buffer)).toBe(true);
});
