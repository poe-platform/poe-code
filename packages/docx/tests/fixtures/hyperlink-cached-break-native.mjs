import { Volume } from "memfs";
import * as api from "../../src/index.ts";
import { ModelStore } from "../../src/model-store.ts";
import { archiveSettings } from "../../src/archive.ts";

export function run(request) {
  const memory = Volume.fromJSON(Object.fromEntries(request.members.map(member =>
    ["/" + member.name, Buffer.from(member.bytes, "base64")])));
  const members = request.members.map(member => ({ ...member, modified: new Date(member.modified),
    bytes: new Uint8Array(memory.readFileSync("/" + member.name)) }));
  const context = { ...archiveSettings({ limits: request.limits, signal: new AbortController().signal,
    budget: new api.DocumentBudget({ xmlDepth: 16384, retainedBytes: 2 ** 30, work: 2 ** 30 }) }), author: "", initials: "" };
  const store = new ModelStore({ comment: new Uint8Array(), members }, context, "/word/document.xml");
  const node = store.xml(store.mainPart).root.children[0].children[0];
  const paragraph = new api.Paragraph(store, store.ref(store.mainPart, node));
  let result;
  try {
    result = { ok: true, count: paragraph.rendered_page_breaks.length,
      present: paragraph.hyperlinks[0].contains_page_break, text: paragraph.text,
      keep: paragraph.paragraph_format.keep_with_next, italic: paragraph.runs[0].italic,
      exactParagraph: Buffer.from(paragraph.element.serialize()).equals(Buffer.from(request.body)) };
  } catch (error) {
    result = { ok: false, error: String(error), code: error.code ?? null };
  }
  const saved = store.snapshot();
  result.exactMembers = saved.members.length === members.length && saved.members.every(member =>
    Buffer.from(member.bytes).equals(memory.readFileSync("/" + member.name)));
  return result;
}
