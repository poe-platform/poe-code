import assert from "node:assert/strict";
import { Volume } from "memfs";
import * as api from "../../src/index.js";
import { textContext, textFixture } from "./text.js";

let request = "";
for await (const bytes of process.stdin) request += String(bytes);
const { strict, depth, action, route } = JSON.parse(request) as {
  strict: boolean; depth: number; action: "read" | "rename" | "remove"; route: "sdk" | "cli";
};
const memory = Volume.fromJSON({ "/input": "", "/out": "", "/err": "" });
const limits = { ...textContext.limits, maxArchiveBytes: 2 ** 21, maxEntryBytes: 2 ** 20, maxTotalBytes: 2 ** 22, maxRetainedBytes: 2 ** 31 };
const documentLimits = { xmlDepth: depth + 16, retainedBytes: 2 ** 31, work: 2 ** 31 };
const context = () => ({ ...textContext, limits, budget: new api.DocumentBudget(documentLimits) });
const base = await textFixture('<w:p><w:bookmarkStart w:id="11" w:name="Coast"/><w:r><w:rPr><w:b/></w:rPr><w:t>Target é 海</w:t></w:r><w:bookmarkEnd w:id="11"/></w:p><w:sectPr/>', {}, strict);
const archive = await api.readArchive(base, context());
const main = archive.members.find(m => m.name === "word/document.xml")!;
const original = new TextDecoder().decode(main.bytes);
const cache = '<w:p><w:hyperlink w:anchor="Coast"><!--link--><?link keep?><w:fldSimple w:instr=" REF Coast \\h " w:dirty="0" w:fldLock="1"><w:r><w:rPr><w:i/><w:rtl/></w:rPr><w:t>Cached é 海</w:t></w:r></w:fldSimple></w:hyperlink></w:p>';
const source = original.replace('<w:document ', '<w:document xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:deep-bookmark" mc:Ignorable="f" mc:ProcessContent="f:pass" ').replace('<w:sectPr/>', '<f:pass>'.repeat(depth) + cache + '</f:pass>'.repeat(depth) + '<w:sectPr/>');
await api.writeArchive({ ...archive, members: archive.members.map(m => m === main ? { ...m, bytes: new TextEncoder().encode(source) } : m) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, context());
const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
const stdout = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
try {
  if (route === "sdk") {
    if (action === "read") {
      const result = await api.inspectDocumentBookmarks(input, {}, context());
      assert.equal(result.items.length, 1); assert.equal(result.items[0]!.name, "Coast"); assert.deepEqual(result.issues, []);
    } else {
      const result = await api.editDocumentBookmarks(input, action === "rename" ? { operation: "bookmarks.set", options: { bookmark: 1, name: "Bay", references: "update", output: "-" } } : { operation: "bookmarks.remove", options: { bookmark: 1, references: "remove", output: "-" } }, { ...context(), stdout, encoding: { order: "input", compression: "store" } });
      assert.equal(result.changes.length, 1);
    }
  } else {
    const args = action === "read" ? ["bookmarks", "list", "/input", "--json"] : ["bookmarks", action === "rename" ? "set" : "remove", "/input", "--bookmark", "1", "--references", action === "rename" ? "update" : "remove", ...(action === "rename" ? ["--name", "Bay"] : []), "--output", "-"];
    const result = await api.createDocxInspectionCommandEngine({ limits, documentLimits }).execute({ args: args.map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(memory.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(bytes) { memory.appendFileSync("/err", bytes); } } });
    assert.equal(result.exitCode, 0, memory.readFileSync("/err", "utf8") as string);
    if (action === "read") {
      const result = JSON.parse(memory.readFileSync("/out", "utf8") as string); assert.equal(result.data.items[0].name, "Coast"); assert.deepEqual(result.data.issues, []); assert.equal(result.affected, 0);
    }
  }
  assert.deepEqual(memory.readFileSync("/input"), Buffer.from(input));
  if (action !== "read") {
    const saved = await api.readArchive(new Uint8Array(memory.readFileSync("/out") as Buffer), context());
    const expected = action === "rename" ? source.replace('w:name="Coast"', 'w:name="Bay"').replace('w:anchor="Coast"', 'w:anchor="Bay"').replace(' REF Coast ', ' REF Bay ') : source.replace('<w:bookmarkStart w:id="11" w:name="Coast"/>', '').replace('<w:bookmarkEnd w:id="11"/>', '').replace('<w:hyperlink w:anchor="Coast">', '').replace('</w:hyperlink>', '').replace('<w:fldSimple w:instr=" REF Coast \\h " w:dirty="0" w:fldLock="1">', '').replace('</w:fldSimple>', '');
    assert.equal(saved.members.length, archive.members.length);
    for (const member of archive.members) assert.deepEqual(saved.members.find(m => m.name === member.name)!.bytes, member === main ? new TextEncoder().encode(expected) : member.bytes, member.name);
    const fields = await api.inspectDocumentFields(new Uint8Array(memory.readFileSync("/out") as Buffer), {}, context());
    assert.equal(fields.items.length, action === "rename" ? 1 : 0);
    if (action === "rename") assert.equal(fields.items[0]!.result, "Cached é 海");
  }
  console.log(JSON.stringify({ ok: true, strict, depth, action, route }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, strict, depth, action, route, error: String(error), stack: error instanceof Error ? error.stack : undefined }));
}
