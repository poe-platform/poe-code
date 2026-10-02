import { Volume } from "memfs";
import { DocumentBudget, Paragraph } from "../../src/index.js";
import { archiveSettings, type ArchiveLimits, type ArchiveMember } from "../../src/archive.js";
import { ModelStore } from "../../src/model-store.js";

export function run(request: {
  members: (Omit<ArchiveMember, "bytes" | "modified"> & { bytes: string; modified: string })[];
  limits: ArchiveLimits;
}) {
  const memory = Volume.fromJSON(Object.fromEntries(request.members.map(member =>
    ["/" + member.name, Buffer.from(member.bytes, "base64")])));
  const members = request.members.map(member => ({ ...member, modified: new Date(member.modified),
    bytes: new Uint8Array(memory.readFileSync("/" + member.name) as Buffer) }));
  const context = { ...archiveSettings({ limits: request.limits, signal: new AbortController().signal,
    budget: new DocumentBudget({ xmlDepth: 16384, retainedBytes: 2 ** 30, work: 2 ** 30 }) }),
    author: "", initials: "" };
  const store = new ModelStore({ comment: new Uint8Array(), members }, context, "/word/document.xml");
  const node = store.xml(store.mainPart).root.children[0]!.children[0]!;
  const paragraph = new Paragraph(store, store.ref(store.mainPart, node));
  const text = paragraph.text, keep = paragraph.paragraph_format.keep_with_next;
  const saved = store.snapshot();
  return { ok: true, text, keep, exactMembers: saved.members.length === members.length &&
    saved.members.every(member => Buffer.from(member.bytes).equals(memory.readFileSync("/" + member.name) as Buffer)) };
}
