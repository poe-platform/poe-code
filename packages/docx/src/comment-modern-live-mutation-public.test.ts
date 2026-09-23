import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const native = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const runtime of ["source", "native"] as const) for (const route of ["model", "sdk", "cli"] as const)
for (const scenario of ["affected", "unrelated", "affected-missing-styles"] as const)
for (const action of ["author", "paragraph", "table", "paragraph-text", "run-text", "xml-author", "author-noop"] as const)
it(`affected unknown modern metadata refuses live mutation atomically; strict=${strict}; kind=${kind}; codec=${codec}; runtime=${runtime}; route=${route}; action=${action}; scenario=${scenario}`, async () => {
  const product: typeof api = runtime === "native" ? native as unknown as typeof api : api;
  const context = { limits: textContext.limits, signal: textContext.signal, encoding: { order: "input", compression: "store" } as const };
  const initial = await textFixture('<w:p><w:r><w:t>Outside</w:t></w:r></w:p>', {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}" xmlns:p="http://schemas.microsoft.com/office/word/2010/wordml"><w:comment w:id="7" w:author="Archive"><w:p p:paraId="000000A1"><w:r><w:t>Original</w:t></w:r></w:p></w:comment><w:comment w:id="42" w:author="Independent"><w:p><w:r><w:t>Classic</w:t></w:r></w:p></w:comment><!--retain--><?audit exact?></w:comments>` },
    ...(scenario === "affected-missing-styles" ? {} : { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="Comment Text"/></w:style></w:styles>` } }),
    thread: { kind: "commentsExtended", xml: '<m:commentsEx xmlns:m="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:u="urn:original:modern"><m:commentEx m:paraId="000000A1" m:done="0" u:checksum="opaque-owned"/></m:commentsEx>' }
  }, strict, { kind });
  const parts = readPackage(initial), relationships = new product.DocumentXmlEditor(parts.get("word/_rels/document.xml.rels")!);
  relationships.setAttribute(relationships.root.children.find(node => node.attributes.some(attribute => attribute.localName === "Id" && attribute.value === "thread"))!, "Type", "http://schemas.microsoft.com/office/2011/relationships/commentsExtended");
  parts.set("word/_rels/document.xml.rels", relationships.serialize());
  if (codec !== "utf8") for (const [name, bytes] of parts) {
    const encoded = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le");
    if (codec === "utf16be") encoded.swap16();
    parts.set(name, new Uint8Array(encoded));
  }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const rejected = scenario !== "unrelated" && action !== "author-noop", commentId = scenario === "unrelated" ? 42 : 7;
  const originalAuthor = scenario === "unrelated" ? "Independent" : "Archive", originalText = scenario === "unrelated" ? "Classic" : "Original";
  const value = action === "author-noop" ? originalAuthor : "Updated";
  const operations: Record<string, unknown>[] = [
    { operation: "model.document.Document.comments.get", receiver: ref("document"), arguments: {}, resultHandle: "comments" },
    { operation: "model.comments.Comments.get.call", receiver: ref("comments"), arguments: { commentId }, resultHandle: "comment" }
  ];
  if (action === "paragraph-text" || action === "run-text") {
    operations.push({ operation: "model.comments.Comment.paragraphs.get", receiver: ref("comment"), arguments: {}, resultHandle: "paragraphs" });
    if (action === "run-text") operations.push({ operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" });
    operations.push({ operation: action === "run-text" ? "model.text.run.Run.text.set" : "model.text.paragraph.Paragraph.text.set", receiver: ref(action === "run-text" ? "runs" : "paragraphs", 0), arguments: { value } });
  } else if (action === "xml-author") {
    operations.push({ operation: "model.comments.Comment.element.get", receiver: ref("comment"), arguments: {}, resultHandle: "element" });
    operations.push({ operation: "model.XmlElementView.set_attribute.call", receiver: ref("element"), arguments: { name: { namespaceURI: strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w, localName: "author" }, value } });
  } else operations.push({ operation: action === "paragraph" ? "model.comments.Comment.add_paragraph.call" : action === "table" ? "model.comments.Comment.add_table.call" : "model.comments.Comment.author.set", receiver: ref("comment"), arguments: action === "paragraph" ? { text: "Added" } : action === "table" ? { rows: 1, cols: 1, width: { value: 1, unit: "in" } } : { value } });
  let output: Uint8Array | undefined;
  if (route === "model") {
    const document = await product.Document(input, context), comment = document.comments.get(commentId)!;
    const mutate = () => {
      if (action === "author" || action === "author-noop") comment.author = value;
      else if (action === "paragraph") comment.add_paragraph("Added");
      else if (action === "table") comment.add_table(1, 1, product.Inches(1));
      else if (action === "paragraph-text") comment.paragraphs[0]!.text = value;
      else if (action === "run-text") comment.paragraphs[0]!.runs[0]!.text = value;
      else comment.element.set_attribute({ namespaceURI: strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w, localName: "author" }, value);
    };
    if (rejected) expect(mutate).toThrowError(expect.objectContaining({ code: "unsupported-edit" })); else mutate();
    if (rejected) { expect(comment.author).toBe(originalAuthor); expect(comment.paragraphs.map(paragraph => paragraph.text)).toEqual([originalText]); }
    await document.save({ async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } });
    output = new Uint8Array(memory.readFileSync("/output") as Buffer);
    if (rejected || action === "author-noop") expect(output).toEqual(original);
  } else if (route === "sdk") {
    const pending = product.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } });
    if (rejected) { await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" }); expect(memory.statSync("/output").size).toBe(0); }
    else { await pending; output = new Uint8Array(memory.readFileSync("/output") as Buffer); }
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination");
    await fs.writeFile("/input", input); await fs.writeFile("/output", destination); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const response = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(rejected ? 1 : 0);
      if (rejected) { expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] }); expect(await fs.readFile("/output")).toEqual(destination); }
      else output = await fs.readFile("/output");
      expect(await fs.readFile("/input")).toEqual(original);
    } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original); expect(readPackage(input)).toEqual(parts);
  if (output) {
    const saved = readPackage(output);
    if (action === "author-noop") expect(output).toEqual(input);
    for (const [name, bytes] of parts) if (name !== "word/comments.xml") expect(saved.get(name), name).toEqual(bytes);
    const reopened = await product.Document(output, context);
    expect(reopened.comments.get(7)!.author).toBe("Archive"); expect(reopened.comments.get(7)!.paragraphs.map(paragraph => paragraph.text)).toEqual(["Original"]);
    if (!rejected && action !== "author-noop") {
      const selected = reopened.comments.get(42)!;
      expect(selected.author).toBe(action === "author" || action === "xml-author" ? "Updated" : "Independent");
      expect(selected.paragraphs.map(paragraph => paragraph.text)).toEqual(action === "paragraph" ? ["Classic", "Added"] : [action === "paragraph-text" || action === "run-text" ? "Updated" : "Classic"]);
      expect(selected.tables).toHaveLength(action === "table" ? 1 : 0);
    }
  }
});
