import assert from "node:assert/strict";
import { Volume } from "memfs";
import * as api from "../../src/index.js";
import { textContext, textFixture, w } from "./text.js";
let request = "";
for await (const bytes of process.stdin) request += String(bytes);
const { strict, depth, kind, route } = JSON.parse(request) as { strict: boolean; depth: number; kind: "footnote" | "endnote"; route: "sdk" | "cli" };
const memory = Volume.fromJSON({ "/input": "", "/out": "", "/err": "" });
const limits = { ...textContext.limits, maxArchiveBytes: 2 ** 21, maxEntryBytes: 2 ** 20, maxTotalBytes: 2 ** 22, maxRetainedBytes: 2 ** 31 };
const documentLimits = { xmlDepth: depth + 16, retainedBytes: 2 ** 31, work: 2 ** 31 };
const context = () => ({ ...textContext, limits, budget: new api.DocumentBudget(documentLimits) });
const base = await textFixture(`<w:p><w:r><w:${kind}Reference w:id="8"/><w:t>Body é 海</w:t></w:r></w:p><w:sectPr/>`, {
  [kind + "s"]: { kind: kind + "s", xml: `<w:${kind}s xmlns:w="${w}"><w:${kind} w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}><w:${kind} w:id="0" w:type="continuationSeparator"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}><w:${kind} w:id="8"><w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:${kind}Ref/></w:r><w:r><w:t>Old é 海</w:t></w:r></w:p></w:${kind}></w:${kind}s>` }
}, strict);
const archive = await api.readArchive(base, context()), main = archive.members.find(m => m.name === "word/document.xml")!;
const source = new TextDecoder().decode(main.bytes).replace('<w:document ', '<w:document xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:deep-note" mc:Ignorable="f" mc:ProcessContent="f:pass" ').replace('<w:sectPr/>', '<f:pass>'.repeat(depth) + '<w:p><w:r><w:t>Unselected deep é 海</w:t></w:r></w:p>' + '</f:pass>'.repeat(depth) + '<w:sectPr/>');
await api.writeArchive({ ...archive, members: archive.members.map(m => m === main ? { ...m, bytes: new TextEncoder().encode(source) } : m) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, context());
const input = new Uint8Array(memory.readFileSync("/input") as Buffer), stdout = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
try {
  if (route === "sdk") {
    const before = await api.inspectDocumentNotes(input, { operation: "notes.list", options: { kind } }, context());
    assert.equal(before.items[0]!.text, "Old é 海"); assert.equal(before.items[0]!.references.length, 1);
    await api.editDocumentNotes(input, { operation: "notes.set", options: { kind, note: 1, text: "New é 海", output: "-" } }, { ...context(), stdout, encoding: { order: "input", compression: "store" } });
  } else {
    const result = await api.createDocxInspectionCommandEngine({ limits, documentLimits }).execute({ args: ["notes", "set", "/input", "--kind", kind, "--note", "1", "--text", "New é 海", "--output", "-"].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(memory.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(bytes) { memory.appendFileSync("/err", bytes); } } });
    assert.equal(result.exitCode, 0, memory.readFileSync("/err", "utf8") as string);
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), saved = await api.readArchive(output, context());
  assert.equal(saved.members.length, archive.members.length);
  for (const member of archive.members) {
    const actual = saved.members.find(m => m.name === member.name)!.bytes;
    if (member.name !== `word/${kind}s.xml`) assert.deepEqual(actual, member === main ? new TextEncoder().encode(source) : member.bytes, member.name);
    else {
      const oldXml = new TextDecoder().decode(member.bytes), newXml = new TextDecoder().decode(actual);
      const selectedParagraph = '<w:p><w:pPr><w:keepNext/></w:pPr>', prefix = oldXml.slice(0, oldXml.indexOf(selectedParagraph));
      assert.ok(newXml.startsWith(prefix)); assert.ok(newXml.endsWith(`</w:p></w:${kind}></w:${kind}s>`));
      assert.ok(newXml.includes('<w:pPr><w:keepNext/></w:pPr>')); assert.ok(newXml.includes(`<w:${kind}Ref/>`));
      assert.ok(newXml.includes('>New é 海<')); assert.ok(!newXml.includes('Old é 海'));
    }
  }
  const after = await api.inspectDocumentNotes(output, { operation: "notes.list", options: { kind } }, context());
  assert.equal(after.items[0]!.text, "New é 海"); assert.equal(after.items[0]!.id, 8); assert.equal(after.items[0]!.references.length, 1);
  assert.deepEqual(after.separators.map(n => [n.id, n.type]), [[-1, "separator"], [0, "continuationSeparator"]]);
  assert.deepEqual(memory.readFileSync("/input"), Buffer.from(input));
  console.log(JSON.stringify({ ok: true, strict, depth, kind, route }));
} catch (error) { console.log(JSON.stringify({ ok: false, strict, depth, kind, route, error: String(error), stack: error instanceof Error ? error.stack : undefined })); }
