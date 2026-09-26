import { Volume } from "memfs";
import { createInterface } from "node:readline";
import * as api from "../../dist/index.js";
import { ModelStore } from "../../dist/model-store.js";
import { archiveSettings } from "../../dist/archive.js";

let state;

function execute(request) {
  if (request.type === "prepare") {
    if (state) throw new Error("Previous native fixture was not verified");
    const memory = Volume.fromJSON(Object.fromEntries(request.members.map(member => [
      "/" + member.name, Buffer.from(member.bytes, "base64")
    ])));
    const members = request.members.map(member => ({
      ...member, modified: new Date(member.modified),
      bytes: new Uint8Array(memory.readFileSync("/" + member.name))
    }));
    const signal = new AbortController().signal;
    const context = {
      ...archiveSettings({ limits: request.limits, signal,
        budget: new api.DocumentBudget({ xmlDepth: 16384, retainedBytes: 2 ** 30, work: 2 ** 30 }, signal, async () => {}) }),
      author: "", initials: ""
    };
    const store = new ModelStore({ comment: new Uint8Array(), members }, context, "/word/document.xml");
    const node = store.xml(store.mainPart).root.children[0].children[0];
    const paragraph = new api.Paragraph(store, store.ref(store.mainPart, node));
    state = { memory, members, store, paragraph, body: request.body };
    return { ready: true };
  }
  if (!state) throw new Error("Native fixture has not been prepared");
  const { memory, members, store, paragraph, body } = state;
  if (request.type === "verify") {
    const saved = store.snapshot();
    const result = {
      exactParagraph: Buffer.from(paragraph.element.serialize()).equals(Buffer.from(body)),
      exactMembers: saved.members.length === members.length && saved.members.every(member =>
        Buffer.from(member.bytes).equals(memory.readFileSync("/" + member.name)))
    };
    state = undefined;
    return result;
  }
  if (request.type !== "iterate") throw new Error("Unexpected native fixture request");
  let result;
  try {
    const contents = [...paragraph.runs[1].iter_inner_content()];
    result = {
      ok: true,
      count: contents.filter(item => item instanceof api.RenderedPageBreak).length,
      strings: contents.filter(item => typeof item === "string"),
      fragments: contents.filter(item => item instanceof api.RenderedPageBreak).map(item => [
        item.preceding_paragraph_fragment?.text, item.following_paragraph_fragment?.text
      ]),
      present: paragraph.contains_page_break,
      text: paragraph.text,
      keep: paragraph.paragraph_format.keep_with_next,
      italic: paragraph.runs[0].italic
    };
  } catch (error) {
    result = { ok: false, error: String(error), code: error.code ?? null };
  }
  return result;
}

console.log(JSON.stringify({ ready: true }));
for await (const line of createInterface({ input: process.stdin })) {
  console.log(JSON.stringify(execute(JSON.parse(line))));
}
