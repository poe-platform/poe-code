import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, run, textContext, textFixture, w } from "../tests/fixtures/text.js";

const w14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const w15 = "http://schemas.microsoft.com/office/word/2012/wordml";
const cid = "http://schemas.microsoft.com/office/word/2016/wordml/cid";
const cex = "http://schemas.microsoft.com/office/word/2018/wordml/cex";
const metadata = [
  ["thread", "commentsExtended", w15, "commentsEx", "http://schemas.microsoft.com/office/2011/relationships/commentsExtended"],
  ["ids", "commentsIds", cid, "commentsIds", "http://schemas.microsoft.com/office/2016/09/relationships/commentsIds"],
  ["extra", "commentsExtensible", cex, "commentsExtensible", "http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible"],
  ["authors", "people", w15, "people", "http://schemas.microsoft.com/office/2011/relationships/people"]
] as const;
const context: docx.PublicationContext = { ...textContext, encoding: { order: "input", compression: "store" } };
const comment = (id: number, pid: string, text: string, author = "Mira") => `<w:comment w:id="${id}" w:author="${author}"><w:p x:paraId="${pid}">${run(text)}</w:p></w:comment>`;
async function fixture(options: { paragraphId?: string; thread?: string; extra?: string; authors?: string; comments?: string; body?: string } = {}) {
  const contents = [options.thread ?? '<m:commentEx m:paraId="000000A1" m:done="1"/><m:commentEx m:paraId="000000B2" m:paraIdParent="000000A1" m:done="0"/>',
    '<m:commentId m:paraId="000000A1" m:durableId="00000011"/><m:commentId m:paraId="000000B2" m:durableId="00000022"/>',
    options.extra ?? '<m:commentExtensible m:durableId="00000011" m:dateUtc="2026-01-02T03:04:05Z"/><m:commentExtensible m:durableId="00000022"/>',
    options.authors ?? '<m:person m:author="Mira"><m:presenceInfo m:providerId="None" m:userId="Mira"/></m:person>'];
  const bytes = await textFixture(options.body ?? paragraph("Coastal survey"), {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}" xmlns:x="${w14}" xmlns:newer="urn:future:annotation" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x newer">${options.comments ?? comment(4, options.paragraphId ?? "000000A1", "Check depth") + comment(9, "000000B2", "Depth confirmed")}</w:comments>` },
    ...Object.fromEntries(metadata.map(([name, kind, ns, root], i) => [name, { kind, xml: `<m:${root} xmlns:m="${ns}" xmlns:newer="urn:future:annotation">${contents[i]!.split("000000A1").join(options.paragraphId ?? "000000A1")}</m:${root}>` }]))
  });
  const archive = await docx.readArchive(bytes, textContext);
  const member = archive.members.find(m => m.name === "word/_rels/document.xml.rels")!;
  const editor = new docx.DocumentXmlEditor(member.bytes);
  for (const [name, , , , rel] of metadata) editor.setAttribute(editor.root.children.find(n => n.attributes.some(a => a.localName === "Id" && a.value === name))!, "Type", rel);
  const volume = Volume.fromJSON({ "/out": "" });
  await docx.writeArchive({ ...archive, members: archive.members.map(m => m === member ? { ...m, bytes: editor.serialize() } : m) }, { async write(b) { volume.appendFileSync("/out", b); } }, context.encoding, textContext);
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}
const read = (bytes: Uint8Array) => docx.inspectDocumentComments(bytes, { operation: "comments.list", options: {} }, textContext);
async function command(bytes: Uint8Array, args: string[]) {
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes), "/out": "", "/err": "" });
  const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: args.map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(b) { volume.appendFileSync("/out", b); } }, stderr: { async write(b) { volume.appendFileSync("/err", b); } }
  });
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(bytes));
  return { result, bytes: new Uint8Array(volume.readFileSync("/out") as Buffer), error: volume.readFileSync("/err", "utf8").toString() };
}
async function parts(bytes: Uint8Array) { return new Map((await docx.readArchive(bytes, textContext)).members.map(m => [m.name, new TextDecoder().decode(m.bytes)])); }

it("inventories extension identifiers, unknown attributes and nested entity metadata through CLI and SDK", async () => {
  const input = await fixture({ extra: '<m:commentExtensible m:durableId="00000011" newer:flag="retained"><m:extLst><newer:entity xmlns:e="http://schemas.microsoft.com/office/word/2026/wordml/cei"><e:commentEntityInfo e:entityType="2"/></newer:entity></m:extLst></m:commentExtensible>' });
  const data = await read(input);
  expect(data).toMatchObject({ modern: "preserve", extensions: metadata.map(([name, kind, namespace]) => ({ part: `/word/${name}.xml`, kind, namespace })) });
  expect(JSON.stringify(data)).toContain("00000011");
  expect(JSON.stringify(data)).toContain("entityType");
  expect(JSON.stringify(data)).toContain("retained");
  const cli = await command(input, ["comments", "list", "/input.docx", "--json"]);
  expect(cli.result.exitCode).toBe(0);
  expect(JSON.parse(new TextDecoder().decode(cli.bytes)).data).toEqual(data);
});

it("preserves every extension byte on unrelated text replacement", async () => {
  const input = await fixture({ thread: '<m:commentEx m:paraId="000000A1" newer:checksum="opaque"/>' });
  const output = await command(input, ["text", "replace", "/input.docx", "--find", "Coastal", "--with", "Ocean", "--all", "--output", "-"]);
  expect(output.result.exitCode, output.error).toBe(0);
  const before = await parts(input), after = await parts(output.bytes);
  for (const [name, xml] of before) if (name !== "word/document.xml") expect(after.get(name)).toBe(xml);
});

it.each([1, 2])("edits a resolved parent or reply while retaining paragraph IDs and metadata (%s)", async ordinal => {
  const input = await fixture({ comments: comment(4, "000000A1", "Check depth").split("<w:p ").join('<w:p newer:keep="yes" ') + comment(9, "000000B2", "Depth confirmed").split("<w:p ").join('<w:p newer:keep="yes" ') });
  const output = await command(input, ["comments", "set", "/input.docx", "--comment", String(ordinal), "--text", "Updated observation", "--output", "-"]);
  expect(output.result.exitCode, output.error).toBe(0);
  expect((await read(output.bytes)).items[ordinal - 1]!.text).toBe("Updated observation");
  const before = await parts(input), after = await parts(output.bytes);
  for (const [name, xml] of before) if (name !== "word/comments.xml") expect(after.get(name)).toBe(xml);
  expect(after.get("word/comments.xml")).toContain('newer:keep="yes"');
  expect(after.get("word/comments.xml")).toContain('x:paraId="000000B2"');
});

it("removes a leaf reply and its ID records without changing parent resolution or shared people", async () => {
  const input = await fixture();
  const output = await command(input, ["comments", "remove", "/input.docx", "--comment", "2", "--output", "-"]);
  expect(output.result.exitCode, output.error).toBe(0);
  const before = await parts(input), after = await parts(output.bytes);
  expect((await read(output.bytes)).items.map(n => n.comment_id)).toEqual([4]);
  expect(after.get("word/thread.xml")).not.toContain("000000B2");
  expect(after.get("word/thread.xml")).toContain('m:done="1"');
  expect(after.get("word/ids.xml")).not.toContain("00000022");
  expect(after.get("word/extra.xml")).not.toContain("00000022");
  expect(after.get("word/authors.xml")).toBe(before.get("word/authors.xml"));
  expect(after.get("word/_rels/document.xml.rels")).toBe(before.get("word/_rels/document.xml.rels"));
});

it.each([false, true])("removes the whole selected thread and retains people only when a revision still owns them (%s)", async revision => {
  const input = await fixture({ body: paragraph("Visible") + (revision ? '<w:p><w:ins w:id="8" w:author="Mira" w:date="2026-01-01T00:00:00Z">' + run("Added") + '</w:ins></w:p>' : "") });
  const output = await command(input, ["comments", "remove", "/input.docx", "--all", "--output", "-"]);
  expect(output.result.exitCode, output.error).toBe(0);
  expect((await read(output.bytes)).items).toEqual([]);
  expect((await parts(output.bytes)).get("word/authors.xml")!.includes('m:author="Mira"')).toBe(revision);
});

it.each([
  ["parent with surviving reply", {}, "remove", 1],
  ["unknown affected attribute", { thread: '<m:commentEx m:paraId="000000A1" newer:checksum="opaque"/>' }, "set", 1],
  ["unknown affected payload", { extra: '<m:commentExtensible m:durableId="00000011"><m:extLst><newer:entity/></m:extLst></m:commentExtensible>' }, "remove", 1],
  ["multiple paragraphs", { comments: comment(4, "000000A1", "First").split('</w:comment>').join('<w:p x:paraId="000000C3">' + run("Last") + '</w:p></w:comment>') + comment(9, "000000B2", "Reply") }, "set", 1],
  ["ambiguous paragraph ID", { comments: comment(4, "000000A1", "First") + comment(9, "000000A1", "Second") }, "set", 1],
  ["follow-up placeholder", { extra: '<m:commentExtensible m:durableId="00000011" m:intelligentPlaceholder="1"/>' }, "set", 1]
] as const)("refuses %s deterministically before publication", async (_label, options, action, ordinal) => {
  const input = await fixture(options);
  const volume = Volume.fromJSON({ "/out": "" });
  const request = { operation: `comments.${action}`, options: { comment: ordinal, ...(action === "set" ? { text: "Changed" } : {}), output: "-" } } as docx.CommentEditRequest;
  for (let i = 0; i < 2; i++) await expect(docx.editDocumentComments(input, request, { ...context, stdout: { async write(b) { volume.appendFileSync("/out", b); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(volume.readFileSync("/out").length).toBe(0);
  const cli = await command(input, ["comments", action, "/input.docx", "--comment", String(ordinal), ...(action === "set" ? ["--text", "Changed"] : []), "--dry-run", "--json"]);
  expect(cli.result.exitCode).toBe(1);
  expect(JSON.parse(new TextDecoder().decode(cli.bytes))).toMatchObject({ ok: false, affected: 0, data: null, errors: [{ code: "unsupported-edit" }] });
});

it("preserves unknown metadata owned by an unselected comment", async () => {
  const input = await fixture({ extra: '<m:commentExtensible m:durableId="00000011" newer:checksum="opaque"><m:extLst><newer:data/></m:extLst></m:commentExtensible><m:commentExtensible m:durableId="00000022"/>' });
  const output = await command(input, ["comments", "remove", "/input.docx", "--comment", "2", "--output", "-"]);
  expect(output.result.exitCode, output.error).toBe(0);
  expect((await parts(output.bytes)).get("word/extra.xml")).toContain('<m:commentExtensible m:durableId="00000011" newer:checksum="opaque"><m:extLst><newer:data/></m:extLst></m:commentExtensible>');
});

it("declares the verified synchronization subset without advertising thread authoring", () => {
  const invocation = docx.parseDocxArguments(["capabilities"].map(s => new TextEncoder().encode(s)));
  expect(docx.getDocxDiscovery(invocation)!.data).toMatchObject({ features: expect.arrayContaining([{
    id: "F25", level: "edit", detected: null, subsets: expect.arrayContaining([expect.objectContaining({ name: "comment-extension-synchronization", level: "edit" })])
  }]) });
});

it("rejects removal of unknown paragraph metadata instead of treating its namespace as understood", async () => {
  const input = await fixture({ comments: comment(4, "000000A1", "Parent") + comment(9, "000000B2", "Reply").split('<w:p ').join('<w:p x:futureChecksum="opaque" ') });
  await expect(docx.editDocumentComments(input, { operation: "comments.remove", options: { comment: 2, dryRun: true } }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("rejects whole-text replacement that would discard an embedded note marker", async () => {
  const input = await fixture({ comments: comment(4, "000000A1", "Parent") + comment(9, "000000B2", "Reply").split('<w:t>Reply</w:t>').join('<w:footnoteRef/><w:t>Reply</w:t>') });
  await expect(docx.editDocumentComments(input, { operation: "comments.set", options: { comment: 2, text: "Changed", dryRun: true } }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("preserves an anchored thread in the Strict dialect through SDK and CLI edits", async () => {
  const anchored = '<w:p><w:commentRangeStart w:id="4"/>' + run("Ocean") + '<w:commentRangeEnd w:id="4"/><w:r><w:commentReference w:id="4"/></w:r></w:p>';
  const base = await fixture({ body: anchored });
  const archive = await docx.readArchive(base, textContext);
  const volume = Volume.fromJSON({ "/strict": "", "/out": "" });
  await docx.writeArchive({ ...archive, members: archive.members.map(m => ({ ...m, bytes: new TextEncoder().encode(new TextDecoder().decode(m.bytes)
    .split(w).join("http://purl.oclc.org/ooxml/wordprocessingml/main")
    .split("http://schemas.openxmlformats.org/officeDocument/2006/relationships").join("http://purl.oclc.org/ooxml/officeDocument/relationships")) })) },
  { async write(b) { volume.appendFileSync("/strict", b); } }, context.encoding, textContext);
  const input = new Uint8Array(volume.readFileSync("/strict") as Buffer);
  const data = await docx.editDocumentComments(input, { operation: "comments.set", options: { comment: 1, text: "New observation", output: "-" } }, { ...context, stdout: { async write(b) { volume.appendFileSync("/out", b); } } });
  expect(data.changes[0]!.after!.value.generation).toBe(1);
  const cli = await command(input, ["comments", "set", "/input.docx", "--comment", "1", "--text", "New observation", "--output", "-"]);
  expect(cli.result.exitCode, cli.error).toBe(0);
  expect(cli.bytes).toEqual(new Uint8Array(volume.readFileSync("/out") as Buffer));
  const removed = await command(cli.bytes, ["comments", "remove", "/input.docx", "--all", "--output", "-"]);
  expect(removed.result.exitCode, removed.error).toBe(0);
  expect((await docx.readDocumentArchive(removed.bytes, textContext)).dialect).toBe("strict");
  expect((await parts(removed.bytes)).get("word/document.xml")).not.toContain("commentRange");
  expect((await read(removed.bytes)).items).toEqual([]);
});

it.each([
  { thread: '<m:commentEx m:paraId="000000A1" m:paraIdParent="000000B2"/><m:commentEx m:paraId="000000B2" m:paraIdParent="000000A1"/>' },
  { thread: '<m:commentEx m:paraId="000000A1"/><m:commentEx m:paraId="000000A1"/>' },
  { thread: '<m:commentEx m:paraId="000000A1"/><m:commentEx m:paraId="000000B2" m:paraIdParent="000000FF"/>' },
  { extra: '<m:commentExtensible m:durableId="000000FF"/>' },
  { authors: '<m:person m:author="Mira" newer:identity="opaque"/>' }
])("refuses inconsistent identities and unknown person cleanup (%j)", async options => {
  const input = await fixture(options);
  await expect(docx.editDocumentComments(input, { operation: "comments.remove", options: { all: true, dryRun: true } }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("refuses an unverified author owner when cleaning up people", async () => {
  const input = await fixture({ body: '<w:p w:author="Mira">' + run("Visible") + '</w:p>' });
  await expect(docx.editDocumentComments(input, { operation: "comments.remove", options: { all: true, dryRun: true } }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
});

it.each(["00000000", "80000000", "FFFFFFFF"])("refuses an out-of-range paragraph identity (%s)", async paragraphId => {
  const input = await fixture({ paragraphId });
  await expect(docx.editDocumentComments(input, { operation: "comments.set", options: { comment: 1, text: "Changed", dryRun: true } }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("accepts the maximum paragraph identity without rewriting its representation", async () => {
  const input = await fixture({ paragraphId: "7fffffff" });
  const output = await command(input, ["comments", "set", "/input.docx", "--comment", "1", "--text", "Changed", "--output", "-"]);
  expect(output.result.exitCode, output.error).toBe(0);
  expect((await parts(output.bytes)).get("word/comments.xml")).toContain('x:paraId="7fffffff"');
});

it("refuses text edits requiring an unimplemented paragraph-version update", async () => {
  const input = await fixture({ comments: comment(4, "000000A1", "Parent") + comment(9, "000000B2", "Reply").split('<w:p ').join('<w:p x:textId="00000003" ') });
  await expect(docx.editDocumentComments(input, { operation: "comments.set", options: { comment: 2, text: "Changed", dryRun: true } }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
});

it.each(["conflictIns", "conflictDel"])("retains people owned by an extension revision (%s)", async kind => {
  const input = await fixture({ body: `<w:p><x:${kind} xmlns:x="${w14}" w:id="12" w:author="Mira" w:date="2026-01-01T00:00:00Z">${run("Review observation")}</x:${kind}></w:p>` });
  const output = await command(input, ["comments", "remove", "/input.docx", "--all", "--output", "-"]);
  expect(output.result.exitCode, output.error).toBe(0);
  const before = await parts(input), after = await parts(output.bytes);
  expect((await read(output.bytes)).items).toEqual([]);
  expect(after.get("word/authors.xml")).toBe(before.get("word/authors.xml"));
  expect(after.get("word/document.xml")).toBe(before.get("word/document.xml"));
});

it("refuses people cleanup when an unknown extension carries an annotation author", async () => {
  const input = await fixture({ body: '<w:p><future:review xmlns:future="urn:future:review" w:author="Mira">' + run("Retained observation") + '</future:review></w:p>' });
  const volume = Volume.fromJSON({ "/out": "" });
  for (let i = 0; i < 2; i++) await expect(docx.editDocumentComments(input, { operation: "comments.remove", options: { all: true, output: "-" } }, {
    ...context, stdout: { async write(b) { volume.appendFileSync("/out", b); } }
  })).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(volume.readFileSync("/out").length).toBe(0);
  const output = await command(input, ["comments", "remove", "/input.docx", "--all", "--dry-run", "--json"]);
  expect(output.result.exitCode).toBe(1);
  expect(JSON.parse(new TextDecoder().decode(output.bytes))).toMatchObject({ ok: false, affected: 0, data: null, errors: [{ code: "unsupported-edit" }] });
});
