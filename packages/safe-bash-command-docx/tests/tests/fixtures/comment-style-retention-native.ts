import assert from "node:assert/strict";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "../../../src/sdk.js";
import { textContext, textFixture } from "../../../../safe-bash-docx-engine/tests/fixtures/text.js";
import { readPackage } from "../../../../safe-bash-docx-engine/tests/assertions.js";

interface Request {
  strict: boolean;
  kind: "docx" | "dotx";
  count: number;
  route: "model" | "sdk" | "cli";
}
const ref = (resultHandle: string) => ({ resultHandle });

export async function verifyCommentStyleRetention({ strict, kind, count, route }: Request): Promise<void> {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const opaque = `<f:opaque>${"<f:leaf/>".repeat(count)}</f:opaque>`;
  const styles = `<w:styles xmlns:w="${word}" xmlns:f="urn:original:comment-style-fanout" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>${opaque}<!--retain--><?audit exact?></w:styles>`;
  const archive = await api.readArchive(await textFixture('<w:p><w:r><w:t>Retained海🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${word}"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style></w:styles>` } }, strict, { kind }), textContext);
  const limits = { ...textContext.limits, maxArchiveBytes: 4194304, maxEntryBytes: 2097152, maxTotalBytes: 4194304, maxRetainedBytes: 2147483648 }, documentLimits = { retainedBytes: 2147483648, work: 2147483648 }, signal = new AbortController().signal;
  const context = { ...textContext, limits, signal, budget: new api.DocumentBudget(documentLimits, signal), timestamp: new Date("2026-03-04T05:06:07Z"), encoding: { order: "input", compression: "store" } as const };
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ ...archive, members: archive.members.map(member => member.name === "word/styles.xml" ? { ...member, bytes: new TextEncoder().encode(styles) } : member) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = readPackage(input, limits), operations = [
    { operation: "model.document.Document.comments.get", receiver: ref("document"), arguments: {}, resultHandle: "comments" },
    { operation: "model.comments.Comments.add_comment.call", receiver: ref("comments"), arguments: { text: "Fresh海🌊", author: "Archive", initials: "AR" }, resultHandle: "comment" },
    { operation: "model.comments.Comment.text.get", receiver: ref("comment"), arguments: {} }
  ];
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const document = await api.Document(input, context), comment = document.comments.add_comment("Fresh海🌊", "Archive", "AR");
    assert.equal(comment.text, "Fresh海🌊"); await document.save(sink);
  } else if (route === "sdk") {
    const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, context); assert.equal(batch.results.at(-1)!.value, "Fresh海🌊"); await batch.save(sink);
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/destination", destination); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /operations --timestamp 2026-03-04T05:06:07Z --output /destination --force --json");
      assert.equal(Buffer.compare(Buffer.from(await fs.readFile("/input")), Buffer.from(input)), 0); if (result.exitCode !== 0) assert.deepEqual(await fs.readFile("/destination"), destination);
      assert.equal(result.exitCode, 0, result.stdout + result.stderr); assert.equal(JSON.parse(result.stdout).data.results.at(-1).data, "Fresh海🌊"); memory.writeFileSync("/output", await fs.readFile("/destination"));
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output, limits);
  assert.ok(new TextDecoder().decode(after.get("word/styles.xml")!).includes(opaque + "<!--retain--><?audit exact?>"));
  for (const [name, bytes] of before) if (!["[Content_Types].xml", "word/styles.xml", "word/_rels/document.xml.rels"].includes(name)) assert.deepEqual(after.get(name), bytes, name);
  const document = await api.Document(output, { ...context, budget: new api.DocumentBudget(documentLimits, signal) }), comment = document.comments.get(0)!;
  assert.equal(comment.text, "Fresh海🌊"); assert.equal(comment.author, "Archive"); assert.equal(comment.initials, "AR"); assert.equal(comment.timestamp?.toISOString(), "2026-03-04T05:06:07.000Z");
  assert.equal(comment.paragraphs[0]!.style?.equals(document.styles.at("Comment Text")), true);
  assert.equal(comment.paragraphs[0]!.runs[0]!.style?.equals(document.styles.at("Comment Reference")), true);
  assert.equal(Buffer.compare(memory.readFileSync("/input") as Buffer, Buffer.from(input)), 0);
}
