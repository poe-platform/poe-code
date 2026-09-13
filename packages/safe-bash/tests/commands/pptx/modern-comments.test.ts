import assert from "node:assert/strict";
import test, { after, before, mock } from "node:test";
import { Volume } from "memfs";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine, createPresentation, readComments, readCommentAuthors } from "pptx";
import { parseXmlPart } from "../../../../pptx/src/xml.js";
import { storedArchive } from "../../../../pptx/tests/fixtures/archive.js";
import { inspectZip } from "../../../../pptx/tests/zip-reader.js";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

const context = {
  limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: { maxArchiveBytes: 262144, maxEntryBytes: 65536, maxTotalBytes: 262144, maxMembers: 64, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 65536, chunkSize: 4096 },
  xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};
before(() => {
  const timer = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", ((callback: () => void, delay?: number) => delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
after(() => mock.restoreAll());

async function fixture(security?: "signature" | "protection" | "authors-only") {
  const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const m = "http://schemas.microsoft.com/office/powerpoint/2018/8/main";
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const modern = "http://schemas.microsoft.com/office/2018/10/relationships";
  const parts = new Map(inspectZip(await createPresentation({ slides: [{ name: "Harbor" }] }, context)).map(member => [member.name, member.payload]));
  const encode = (value: string) => new TextEncoder().encode(value);
  const append = (name: string, markup: string) => {
    const doc = parseXmlPart(parts.get(name)!, context.xmlLimits);
    parts.set(name, doc.spliceChildren(doc.root, doc.root.children.length, 0, [markup]).bytes());
  };
  const edge = (id: string, type: string, target: string) => `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="${id}" Type="${type}" Target="${target}"/>`;
  for (const [part, type] of [
    ["ppt/comments/legacy.xml", "application/vnd.openxmlformats-officedocument.presentationml.comments+xml"],
    ["ppt/commentAuthors.xml", "application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml"],
    ["ppt/comments/thread.xml", "application/vnd.ms-powerpoint.comments+xml"],
    ["ppt/authors.xml", "application/vnd.ms-powerpoint.authors+xml"]
  ]) append("[Content_Types].xml", `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/${part}" ContentType="${type}"/>`);
  append("ppt/_rels/presentation.xml.rels", edge("legacyAuthors", `${r}/commentAuthors`, "commentAuthors.xml"));
  append("ppt/_rels/presentation.xml.rels", edge("threadAuthors", `${modern}/authors`, "authors.xml"));
  append("ppt/slides/_rels/slide1.xml.rels", edge("legacyReview", `${r}/comments`, "../comments/legacy.xml"));
  append("ppt/slides/_rels/slide1.xml.rels", edge("threadReview", `${modern}/comments`, "../comments/thread.xml"));
  parts.set("ppt/commentAuthors.xml", encode(`<p:cmAuthorLst xmlns:p="${p}"><p:cmAuthor id="7" name="Avery" initials="AV" lastIdx="1" clrIdx="0"/></p:cmAuthorLst>`));
  parts.set("ppt/comments/legacy.xml", encode(`<p:cmLst xmlns:p="${p}"><p:cm authorId="7" idx="1" dt="2026-09-13T12:00:00Z"><p:pos x="0" y="0"/><p:text>Older annotation</p:text></p:cm></p:cmLst>`));
  parts.set("ppt/authors.xml", encode(`<m:authorLst xmlns:m="${m}"><m:author id="person-a" name="Avery" initials="AV" userId="local:avery" providerId="local"/><m:author id="person-b" name="Blair" initials="BL" userId="local:blair" providerId="local"/></m:authorLst>`));
  const body = (text: string) => `<m:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></m:txBody>`;
  parts.set("ppt/comments/thread.xml", encode(`<m:cmLst xmlns:m="${m}" xmlns:a="${a}" xmlns:p="${p}" xmlns:q="http://schemas.microsoft.com/office/powerpoint/2022/03/main" xmlns:u="urn:original:review"><m:cm id="thread-one" authorId="person-a" created="2026-09-13T13:00:00Z" status="active">${body("Harbor — 明日")}<m:replyLst><m:reply id="reply-one" authorId="person-b" created="2026-09-13T13:01:00Z">${body("Agreed 🐚")}</m:reply></m:replyLst><m:extLst><p:ext uri="urn:original:review-extra"><q:reactions><q:rxn type="like"><q:instance authorId="person-b" time="2026-09-13T13:02:00Z"/></q:rxn></q:reactions><u:mention personId="person-b" start="0" length="6"/><u:future owner="thread-one">Retain exactly</u:future></p:ext></m:extLst></m:cm></m:cmLst>`));
  if (security === "signature") {
    append("[Content_Types].xml", '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/seal.xml" ContentType="application/xml"/>');
    append("_rels/.rels", edge("seal", "http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/origin", "seal.xml"));
    parts.set("seal.xml", encode('<seal xmlns="urn:original:seal"/>'));
  }
  if (security === "protection") append("ppt/presentation.xml", `<p:modifyVerifier xmlns:p="${p}" cryptProviderType="rsaAES"/>`);
  if (security === "authors-only") {
    for (const name of ["ppt/comments/thread.xml", "ppt/comments/legacy.xml", "ppt/commentAuthors.xml"]) parts.delete(name);
    for (const name of ["[Content_Types].xml", "ppt/_rels/presentation.xml.rels", "ppt/slides/_rels/slide1.xml.rels"]) {
      let doc = parseXmlPart(parts.get(name)!, context.xmlLimits);
      for (let index = doc.root.children.length - 1; index >= 0; index--) {
        const attrs = doc.root.children[index]!.attributes;
        if (attrs.some(attr => ["/ppt/comments/thread.xml", "/ppt/comments/legacy.xml", "/ppt/commentAuthors.xml", "legacyAuthors", "legacyReview", "threadReview"].includes(attr.value))) doc = doc.spliceChildren(doc.root, index, 1, []);
      }
      parts.set(name, doc.bytes());
    }
  }
  const bytes = storedArchive([...parts].map(([name, payload]) => ({ name, bytes: payload })));
  const volume = Volume.fromJSON({ "/work/review deck.pptx": Buffer.from(bytes) });
  const fs = new MemoryFileSystem();
  fs.readStream = async function* (path, options) {
    options?.signal?.throwIfAborted();
    yield new Uint8Array(volume.readFileSync(path) as Buffer);
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(pptxCommands({ engine: createPptxCommandEngine({ context, maxOutputBytes: 262144, maxArgumentBytes: 65536 }) }));
  return { bytes, parts, volume, shell };
}

test("modern and legacy comment inventories agree across SDK and shell JSON", async () => {
  const f = await fixture();
  try {
    const result = await f.shell.exec("pptx comments list 'review deck.pptx' --json");
    assert.equal(result.exitCode, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.operation, "comments.list");
    assert.equal(envelope.affected, 0);
    assert.equal(envelope.data.comments.length, 2);
    assert.deepEqual(envelope.data.comments, await readComments(f.bytes, {}, context));
    const record = envelope.data.comments.find((item: { id: string }) => item.id === "thread-one");
    assert.equal(record.format, "modern");
    assert.equal(record.text, "Harbor — 明日");
    assert.equal(record.authorIdentity.userId, "local:avery");
    assert.equal(record.replies[0].authorIdentity.userId, "local:blair");
    assert.equal(record.replies[0].text, "Agreed 🐚");
    assert.equal(record.replies[0].parentId, "thread-one");
    assert.deepEqual(record.reactions, [{ type: "like", instances: [{ authorId: "person-b", timestamp: "2026-09-13T13:02:00Z" }] }]);
    assert.ok(record.opaqueXml.includes('personId="person-b"'));
    const get = await f.shell.exec("pptx comments get 'review deck.pptx' --id thread-one --slide 1 --json");
    assert.equal(get.exitCode, 0, get.stderr);
    assert.deepEqual(JSON.parse(get.stdout).data.comments, [record]);
    const reply = await f.shell.exec("pptx comments get 'review deck.pptx' --id reply-one --slide 1 --json");
    assert.equal(reply.exitCode, 0, reply.stderr);
    assert.deepEqual(JSON.parse(reply.stdout).data.comments, [record.replies[0]]);
    assert.deepEqual(await readComments(f.bytes, { id: "reply-one" }, context), [record.replies[0]]);
    const schema = await f.shell.exec("pptx schema comments get --json");
    assert.equal(compileJsonSchema(JSON.parse(schema.stdout).data.operations["comments.get"].result).validate(JSON.parse(get.stdout)).ok, true);
  } finally { await f.shell.dispose(); }
});

test("comments list exposes modern author identities without inventing absent threads", async () => {
  const f = await fixture("authors-only");
  try {
    const result = await f.shell.exec("pptx comments list 'review deck.pptx' --json");
    assert.equal(result.exitCode, 0, result.stderr);
    const data = JSON.parse(result.stdout).data;
    assert.deepEqual(data.comments, []);
    assert.deepEqual(data.authors, await readCommentAuthors(f.bytes, context));
    assert.deepEqual(data.authors.map((author: { id: string; userId: string }) => [author.id, author.userId]), [["person-a", "local:avery"], ["person-b", "local:blair"]]);
    assert.deepEqual(f.volume.readFileSync("/work/review deck.pptx"), Buffer.from(f.bytes));
  } finally { await f.shell.dispose(); }
});

test("slide rename and legacy comment edit retain modern parts and associations byte for byte", async () => {
  const f = await fixture();
  try {
    for (const command of ["slides set 'review deck.pptx' --slide 1 --name Coast", "comments set 'review deck.pptx' --slide 1 --id 7:1 --text Reviewed"]) {
      const result = await f.shell.exec(`pptx ${command} --output -`);
      assert.equal(result.exitCode, 0, result.stderr);
      const parts = new Map(inspectZip(result.stdoutBytes).map(member => [member.name, member.payload]));
      for (const name of ["ppt/comments/thread.xml", "ppt/authors.xml", "ppt/slides/_rels/slide1.xml.rels", "ppt/_rels/presentation.xml.rels"]) assert.deepEqual(parts.get(name), f.parts.get(name), name);
    }
    assert.deepEqual(f.volume.readFileSync("/work/review deck.pptx"), Buffer.from(f.bytes));
  } finally { await f.shell.dispose(); }
});

for (const security of [undefined, "signature", "protection"] as const) {
  test(`modern comment mutation rejects without publication with ${security ?? "ordinary"} content`, async () => {
    const f = await fixture(security);
    try {
      const read = await f.shell.exec("pptx comments list 'review deck.pptx' --json");
      assert.equal(read.exitCode, 0, read.stderr);
      assert.equal(JSON.parse(read.stdout).data.comments.length, 2);
      const result = await f.shell.exec("pptx comments set 'review deck.pptx' --slide 1 --id thread-one --author Renamed --output -");
      assert.equal(result.exitCode, 1, result.stderr);
      assert.equal(result.stdoutBytes.length, 0);
      assert.ok(result.stderr.includes("unsupported-edit"), result.stderr);
      assert.deepEqual(f.volume.readFileSync("/work/review deck.pptx"), Buffer.from(f.bytes));
    } finally { await f.shell.dispose(); }
  });
}
