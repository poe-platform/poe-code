import { fileURLToPath } from "node:url";
import { Volume } from "memfs";
import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import * as api from "./index.js";
import { archiveSettings, type DocumentArchive } from "./archive.js";
import { useNativeProcess } from "../tests/native-process.js";
import { ModelStore } from "./model-store.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

const execute = useNativeProcess([fileURLToPath(new URL("../tests/fixtures/run-inner-content-native.mjs", import.meta.url))]);
let original: DocumentArchive;
beforeAll(async () => { original = await api.readArchive(await textFixture("<w:p/>"), textContext); });

for (const strict of [false, true]) for (const depth of [32, 4096, 8192])
for (const present of [false, true]) for (const host of ["worker", "main"] as const)
describe(`iterates shallow selected run after admitted native depth without host recursion; strict=${strict}; depth=${depth}; present=${present}; host=${host}`, () => {
  let memory: Volume;
  let members: DocumentArchive["members"];
  let standaloneParagraph: string;
  let paragraph: api.Paragraph;
  let store: ModelStore;
  beforeEach(async () => {
    const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" :
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" :
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const body = `<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Before</w:t></w:r>${'<w:customXml w:element="original">'.repeat(depth)}` +
      "<w:r/>" + "</w:customXml>".repeat(depth) +
      `<w:r><w:t>After</w:t>${present ? "<w:lastRenderedPageBreak/>" : ""}<w:t>Tail</w:t></w:r><!--retain--><?cached keep?></w:p>`;
    memory = Volume.fromJSON(Object.fromEntries(original.members.map(member => ["/" + member.name,
      Buffer.from(new TextDecoder().decode(member.bytes).split("http://schemas.openxmlformats.org/officeDocument/2006/relationships").join(r))])));
    memory.writeFileSync("/word/document.xml", `<w:document xmlns:w="${w}"><w:body>${body}</w:body></w:document>`);
    members = original.members.map(member => ({ ...member, bytes: new Uint8Array(memory.readFileSync("/" + member.name) as Buffer) }));
    const context = { ...archiveSettings({ ...textContext, budget: new api.DocumentBudget({ xmlDepth: 16384,
      retainedBytes: 2 ** 30, work: 2 ** 30 }, textContext.signal, async () => {}) }), author: "", initials: "" };
    standaloneParagraph = body.replace("<w:p>", `<w:p xmlns:w="${w}">`);
    if (host === "worker") {
      // Exercise the real admitted model, XML and compatibility graph. Archive
      // acquisition/publication remain independently executed public obligations.
      store = new ModelStore({ ...original, members }, context, "/word/document.xml");
      const node = store.xml(store.mainPart).root.children[0]!.children[0]!;
      paragraph = new api.Paragraph(store, store.ref(store.mainPart, node));
    } else {
      expect(await execute({ type: "prepare", members: members.map(member => ({ ...member,
        bytes: Buffer.from(member.bytes).toString("base64") })), limits: textContext.limits, body: standaloneParagraph })).toEqual({ ready: true });
    }
  });
  it("iterates the admitted selected run", async () => {
    if (host === "worker") {
      const contents = [...paragraph.runs[1]!.iter_inner_content()];
      expect(contents.filter(item => typeof item === "string")).toEqual(present ? ["After", "Tail"] : ["AfterTail"]);
      expect(contents.filter(item => item instanceof api.RenderedPageBreak)).toHaveLength(present ? 1 : 0);
      for (const item of contents) if (item instanceof api.RenderedPageBreak) {
        expect(item.preceding_paragraph_fragment?.text).toBe("BeforeAfter");
        expect(item.following_paragraph_fragment?.text).toBe("Tail");
      }
      expect(paragraph.contains_page_break).toBe(present);
      expect(paragraph.text).toBe("BeforeAfterTail");
      expect(paragraph.paragraph_format.keep_with_next).toBe(true);
      expect(paragraph.runs[0]!.italic).toBe(true);
    } else {

      const result = await execute({ type: "iterate" });
      expect(result).toEqual({ ok: true, count: present ? 1 : 0, strings: present ? ["After", "Tail"] : ["AfterTail"], fragments: present ? [["BeforeAfter", "Tail"]] : [], present,
        text: "BeforeAfterTail", keep: true, italic: true });
    }
  });
  afterEach(async () => {
    if (host === "worker") {
      expect(Buffer.from(paragraph.element.serialize()).equals(Buffer.from(standaloneParagraph))).toBe(true);
      const snapshot = store.snapshot();
      expect(snapshot.members.map(member => member.name).sort()).toEqual(members.map(member => member.name).sort());
      for (const member of snapshot.members) expect(Buffer.from(member.bytes).equals(memory.readFileSync("/" + member.name) as Buffer)).toBe(true);
    } else {
      expect(await execute({ type: "verify" })).toEqual({ exactParagraph: true, exactMembers: true });
    }
    for (const member of members) expect(Buffer.from(member.bytes).equals(memory.readFileSync("/" + member.name) as Buffer)).toBe(true);
  });
});
