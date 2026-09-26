import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { Volume } from "memfs";
import * as api from "../../dist/index.js";

let state;
console.log(JSON.stringify({ ready: true }));
for await (const raw of createInterface({ input: process.stdin })) {
  const message = JSON.parse(raw);
  const request = message.phase === "prepare" ? message : state.request;
  const { strict, depth, action, route } = request;
  try {
    if (message.phase === "prepare") {
      const signal = new AbortController().signal;
      const memory = Volume.fromJSON({ "/input": "", "/out": "", "/err": "" });
      const limits = { ...request.limits, maxArchiveBytes: 2 ** 21, maxEntryBytes: 2 ** 20, maxTotalBytes: 2 ** 22, maxRetainedBytes: 2 ** 31 };
      const documentLimits = { xmlDepth: depth + 16, retainedBytes: 2 ** 31, work: 2 ** 31 };
      // Depth and retained bytes use the scheduling port; the CLI engine keeps real turns.
      const context = () => ({ signal, limits, budget: new api.DocumentBudget(documentLimits, signal, async () => {}) });
      const base = new Uint8Array(Buffer.from(request.base, "base64"));
      const archive = await api.readArchive(base, context());
      const main = archive.members.find(m => m.name === "word/document.xml");
      const original = new TextDecoder().decode(main.bytes);
      const cache = '<w:p><w:hyperlink w:anchor="Coast"><!--link--><?link keep?><w:fldSimple w:instr=" REF Coast \\h " w:dirty="0" w:fldLock="1"><w:r><w:rPr><w:i/><w:rtl/></w:rPr><w:t>Cached é 海</w:t></w:r></w:fldSimple></w:hyperlink></w:p>';
      const source = original.replace('<w:document ', '<w:document xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:deep-bookmark" mc:Ignorable="f" mc:ProcessContent="f:pass" ').replace('<w:sectPr/>', '<f:pass>'.repeat(depth) + cache + '</f:pass>'.repeat(depth) + '<w:sectPr/>');
      await api.writeArchive({ ...archive, members: archive.members.map(m => m === main ? { ...m, bytes: new TextEncoder().encode(source) } : m) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, context());
      const input = new Uint8Array(memory.readFileSync("/input"));
      const stdout = { async write(bytes) { memory.appendFileSync("/out", bytes); } };
      state = { request, signal, memory, limits, documentLimits, context, archive, main, source, input, stdout };
    } else if (message.phase === "execute") {
      const { signal, memory, limits, documentLimits, context, input, stdout } = state;
      if (route === "sdk") {
        if (action === "read") {
          const result = await api.inspectDocumentBookmarks(input, {}, context());
          assert.equal(result.items.length, 1); assert.equal(result.items[0].name, "Coast"); assert.deepEqual(result.issues, []);
        } else {
          const result = await api.editDocumentBookmarks(input, action === "rename" ? { operation: "bookmarks.set", options: { bookmark: 1, name: "Bay", references: "update", output: "-" } } : { operation: "bookmarks.remove", options: { bookmark: 1, references: "remove", output: "-" } }, { ...context(), stdout, encoding: { order: "input", compression: "store" } });
          assert.equal(result.changes.length, 1);
        }
      } else {
        const args = action === "read" ? ["bookmarks", "list", "/input", "--json"] : ["bookmarks", action === "rename" ? "set" : "remove", "/input", "--bookmark", "1", "--references", action === "rename" ? "update" : "remove", ...(action === "rename" ? ["--name", "Bay"] : []), "--output", "-"];
        const result = await api.createDocxInspectionCommandEngine({ limits, documentLimits }).execute({ args: args.map(s => new TextEncoder().encode(s)), cwd: "/", signal: signal, filesystem: { async readFile(path) { return new Uint8Array(memory.readFileSync(path)); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(bytes) { memory.appendFileSync("/err", bytes); } } });
        assert.equal(result.exitCode, 0, memory.readFileSync("/err", "utf8"));
        if (action === "read") {
          const result = JSON.parse(memory.readFileSync("/out", "utf8")); assert.equal(result.data.items[0].name, "Coast"); assert.deepEqual(result.data.issues, []); assert.equal(result.affected, 0);
        }
      }
    } else if (message.phase === "verify") {
      try {
        const { memory, context, input, archive, main, source } = state;
        assert.deepEqual(memory.readFileSync("/input"), Buffer.from(input));
        if (action !== "read") {
          const saved = await api.readArchive(new Uint8Array(memory.readFileSync("/out")), context());
          const expected = action === "rename" ? source.replace('w:name="Coast"', 'w:name="Bay"').replace('w:anchor="Coast"', 'w:anchor="Bay"').replace(' REF Coast ', ' REF Bay ') : source.replace('<w:bookmarkStart w:id="11" w:name="Coast"/>', '').replace('<w:bookmarkEnd w:id="11"/>', '').replace('<w:hyperlink w:anchor="Coast">', '').replace('</w:hyperlink>', '').replace('<w:fldSimple w:instr=" REF Coast \\h " w:dirty="0" w:fldLock="1">', '').replace('</w:fldSimple>', '');
          assert.equal(saved.members.length, archive.members.length);
          for (const member of archive.members) assert.deepEqual(saved.members.find(m => m.name === member.name).bytes, member === main ? new TextEncoder().encode(expected) : member.bytes, member.name);
          const fields = await api.inspectDocumentFields(new Uint8Array(memory.readFileSync("/out")), {}, context());
          assert.equal(fields.items.length, action === "rename" ? 1 : 0);
          if (action === "rename") assert.equal(fields.items[0].result, "Cached é 海");
        }
      } finally { state = undefined; }
    } else throw new Error("Unknown fixture phase");
    console.log(JSON.stringify({ ok: true, strict, depth, action, route }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, strict, depth, action, route, error: String(error), stack: error instanceof Error ? error.stack : undefined }));
  }
}
