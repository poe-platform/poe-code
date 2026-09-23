import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const native = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const paraNamespace = "http://schemas.microsoft.com/office/word/2010/wordml";
const threadNamespace = "http://schemas.microsoft.com/office/word/2012/wordml";
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const runtime of ["source", "native"] as const) for (const route of ["model", "sdk", "cli"] as const)
for (const scenario of ["author-enters-person", "paragraph-enters-thread", "insert-enters-thread", "known-thread-author", "isolated-thread-author", "isolated-person-author", "inert-thread-author", "inert-person-author"] as const)
it(`modern ownership transitions preserve metadata atomically; strict=${strict}; kind=${kind}; codec=${codec}; runtime=${runtime}; route=${route}; scenario=${scenario}`, async () => {
  const product: typeof api = runtime === "native" ? native as unknown as typeof api : api;
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const people = scenario.includes("person"), inert = scenario.startsWith("inert-");
  const rejected = scenario.endsWith("enters-person") || scenario.endsWith("enters-thread") || scenario === "known-thread-author";
  const commentId = scenario === "known-thread-author" ? 7 : 42;
  const initial = await textFixture('<w:p><w:r><w:t>Outside</w:t></w:r></w:p>', {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}" xmlns:p="${paraNamespace}"><w:comment w:id="7" w:author="Archive"><w:p p:paraId="000000A1"><w:r><w:t>Original</w:t></w:r></w:p></w:comment><w:comment w:id="42" w:author="Independent"><w:p><w:r><w:t>Classic</w:t></w:r></w:p></w:comment><!--retained--><?audit exact?></w:comments>` },
    modern: { kind: people ? "people" : "commentsExtended", xml: people
      ? `<m:people xmlns:m="${threadNamespace}" xmlns:u="urn:opaque"><m:person m:author="Archive" u:checksum="retained"/></m:people>`
      : `<m:commentsEx xmlns:m="${threadNamespace}"><m:commentEx m:paraId="000000A1" m:done="0"/></m:commentsEx>` }
  }, strict, { kind });
  const parts = readPackage(initial), editor = new product.DocumentXmlEditor(parts.get("word/_rels/document.xml.rels")!);
  const edge = editor.root.children.find(node => node.attributes.some(a => a.localName === "Id" && a.value === "modern"))!;
  editor.setAttribute(edge, "Type", inert ? "urn:inert:resource" : `http://schemas.microsoft.com/office/2011/relationships/${people ? "people" : "commentsExtended"}`);
  parts.set("word/_rels/document.xml.rels", editor.serialize());
  if (codec !== "utf8") for (const [name, bytes] of parts) {
    const encoded = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le");
    if (codec === "utf16be") encoded.swap16();
    parts.set(name, new Uint8Array(encoded));
  }
  const context = { limits: textContext.limits, signal: textContext.signal, encoding: { order: "input", compression: "store" } as const };
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const value = scenario === "author-enters-person" ? "Archive" : "Updated";
  const inserted: api.DocxXmlNode = { kind: "element", name: { namespaceURI: word, localName: "comment" }, attributes: [{ name: { namespaceURI: word, localName: "id" }, value: "43" }, { name: { namespaceURI: word, localName: "author" }, value: "Independent" }], children: [{ kind: "element", name: { namespaceURI: word, localName: "p" }, attributes: [{ name: { namespaceURI: paraNamespace, localName: "paraId" }, value: "000000A1" }] }] };
  const operations: Record<string, unknown>[] = [
    { operation: "model.document.Document.comments.get", receiver: ref("document"), arguments: {}, resultHandle: "comments" },
    { operation: "model.comments.Comments.get.call", receiver: ref("comments"), arguments: { commentId }, resultHandle: "comment" }
  ];
  if (scenario === "paragraph-enters-thread") operations.push(
    { operation: "model.comments.Comment.paragraphs.get", receiver: ref("comment"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.element.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "element" },
    { operation: "model.XmlElementView.set_attribute.call", receiver: ref("element"), arguments: { name: { namespaceURI: paraNamespace, localName: "paraId" }, value: "000000A1" } }
  );
  else if (scenario === "insert-enters-thread") operations.push(
    { operation: "model.comments.Comment.part.get", receiver: ref("comment"), arguments: {}, resultHandle: "part" },
    { operation: "model.opc.part.XmlPart.element.get", receiver: ref("part"), arguments: {}, resultHandle: "element" },
    { operation: "model.XmlElementView.insert.call", receiver: ref("element"), arguments: { index: 2, node: inserted } }
  );
  else operations.push({ operation: "model.comments.Comment.author.set", receiver: ref("comment"), arguments: { value } });
  let output: Uint8Array | undefined;
  if (route === "model") {
    const document = await product.Document(input, context), comment = document.comments.get(commentId)!;
    const mutate = () => {
      if (scenario === "paragraph-enters-thread") comment.paragraphs[0]!.element.set_attribute({ namespaceURI: paraNamespace, localName: "paraId" }, "000000A1");
      else if (scenario === "insert-enters-thread") comment.part.element.insert(2, inserted);
      else comment.author = value;
    };
    if (rejected) expect(mutate).toThrowError(expect.objectContaining({ code: "unsupported-edit" })); else mutate();
    await document.save({ async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } });
    output = new Uint8Array(memory.readFileSync("/output") as Buffer);
    if (rejected) expect(output).toEqual(original);
  } else if (route === "sdk") {
    const pending = product.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } });
    if (rejected) { await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" }); expect(memory.statSync("/output").size).toBe(0); }
    else { await pending; output = new Uint8Array(memory.readFileSync("/output") as Buffer); }
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination");
    await fs.writeFile("/input", input); await fs.writeFile("/output", destination); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(rejected ? 1 : 0);
      if (rejected) { expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] }); expect(await fs.readFile("/output")).toEqual(destination); }
      else output = await fs.readFile("/output");
      expect(await fs.readFile("/input")).toEqual(original);
    } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original);
  if (output) {
    const saved = readPackage(output);
    for (const [name, bytes] of parts) if (name !== "word/comments.xml") expect(saved.get(name), name).toEqual(bytes);
    if (!rejected) expect((await product.Document(output, context)).comments.get(42)!.author).toBe("Updated");
  }
});
