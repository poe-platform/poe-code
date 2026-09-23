import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import * as native from "docx";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const runtime of ["source", "native"] as const) for (const route of ["model", "sdk", "cli"] as const)
for (const action of ["author", "paragraph"] as const)
it(`affected unknown modern metadata refuses live mutation atomically; strict=${strict}; kind=${kind}; codec=${codec}; runtime=${runtime}; route=${route}; action=${action}`, async () => {
  const product: typeof api = runtime === "native" ? native as unknown as typeof api : api;
  const context = { limits: textContext.limits, signal: textContext.signal, encoding: { order: "input", compression: "store" } as const };
  const initial = await textFixture('<w:p><w:r><w:t>Outside</w:t></w:r></w:p>', {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}" xmlns:p="http://schemas.microsoft.com/office/word/2010/wordml"><w:comment w:id="7" w:author="Archive"><w:p p:paraId="000000A1"><w:r><w:t>Original</w:t></w:r></w:p></w:comment><!--retain--><?audit exact?></w:comments>` },
    styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="Comment Text"/></w:style></w:styles>` },
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
  const operations = [
    { operation: "model.document.Document.comments.get", receiver: ref("document"), arguments: {}, resultHandle: "comments" },
    { operation: "model.comments.Comments.get.call", receiver: ref("comments"), arguments: { commentId: 7 }, resultHandle: "comment" },
    { operation: action === "author" ? "model.comments.Comment.author.set" : "model.comments.Comment.add_paragraph.call", receiver: ref("comment"), arguments: action === "author" ? { value: "Updated" } : { text: "Added" } }
  ];
  if (route === "model") {
    const document = await product.Document(input, context), comment = document.comments.get(7)!;
    expect(() => { if (action === "author") comment.author = "Updated"; else comment.add_paragraph("Added"); }).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
    expect(comment.author).toBe("Archive"); expect(comment.paragraphs.map(paragraph => paragraph.text)).toEqual(["Original"]);
    await document.save({ async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } });
    expect(new Uint8Array(memory.readFileSync("/output") as Buffer)).toEqual(original);
  } else if (route === "sdk") {
    await expect(product.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(memory.statSync("/output").size).toBe(0);
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination");
    await fs.writeFile("/input", input); await fs.writeFile("/output", destination); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const response = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(1);
      expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] });
      expect(await fs.readFile("/input")).toEqual(original); expect(await fs.readFile("/output")).toEqual(destination);
    } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original); expect(readPackage(input)).toEqual(parts);
});
