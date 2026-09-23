import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture, w, r } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const native = await compiledPublicRuntime;
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const runtime of ["source", "native"] as const) for (const route of ["model", "sdk", "cli"] as const)
for (const action of ["author", "insert", "remove"] as const)
it(`isolated classic part XML mutations retain a usable public comments getter; strict=${strict}; kind=${kind}; codec=${codec}; runtime=${runtime}; route=${route}; action=${action}`, async () => {
  const product: typeof api = runtime === "native" ? native : api;
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const relationship = (strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r) + "/comments";
  const context = { limits: textContext.limits, signal: textContext.signal, encoding: { order: "input", compression: "store" } as const };
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Outside</w:t></w:r></w:p>', {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}" xmlns:p="http://schemas.microsoft.com/office/word/2010/wordml"><w:comment w:id="7" w:author="Archive"><w:p p:paraId="000000A1"><w:r><w:t>Original</w:t></w:r></w:p></w:comment><w:comment w:id="42" w:author="Independent"><w:p><w:r><w:t>Classic</w:t></w:r></w:p></w:comment><!--retain--><?audit exact?></w:comments>` },
    thread: { kind: "commentsExtended", xml: '<m:commentsEx xmlns:m="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:u="urn:opaque"><m:commentEx m:paraId="000000A1" u:checksum="retained"/></m:commentsEx>' }
  }, strict, { kind }));
  const edges = new product.DocumentXmlEditor(parts.get("word/_rels/document.xml.rels")!);
  edges.setAttribute(edges.root.children.find(node => node.attributes.some(a => a.localName === "Id" && a.value === "thread"))!, "Type", "http://schemas.microsoft.com/office/2011/relationships/commentsExtended");
  parts.set("word/_rels/document.xml.rels", edges.serialize());
  if (codec !== "utf8") for (const [name, bytes] of parts) {
    const encoded = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le");
    if (codec === "utf16be") encoded.swap16();
    parts.set(name, new Uint8Array(encoded));
  }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const node: api.DocxXmlNode = { kind: "element", name: { namespaceURI: word, localName: "comment" }, attributes: [{ name: { namespaceURI: word, localName: "id" }, value: "43" }, { name: { namespaceURI: word, localName: "author" }, value: "Independent" }], children: [{ kind: "element", name: { namespaceURI: word, localName: "p" } }] };
  const count = action === "insert" ? 3 : action === "remove" ? 1 : 2;
  const operations: Record<string, unknown>[] = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("main"), arguments: { reltype: relationship }, resultHandle: "part" },
    { operation: "model.parts.comments.CommentsPart.comments.get", receiver: ref("part"), arguments: {}, resultHandle: "before" },
    { operation: "model.opc.part.XmlPart.element.get", receiver: ref("part"), arguments: {}, resultHandle: "root" },
    { operation: "model.XmlElementView.children.get", receiver: ref("root"), arguments: {}, resultHandle: "children" },
    action === "insert" ? { operation: "model.XmlElementView.insert.call", receiver: ref("root"), arguments: { index: 2, node } }
      : action === "remove" ? { operation: "model.XmlElementView.remove.call", receiver: ref("children", 1), arguments: {} }
        : { operation: "model.XmlElementView.set_attribute.call", receiver: ref("children", 1), arguments: { name: { namespaceURI: word, localName: "author" }, value: "Updated" } },
    { operation: "model.parts.comments.CommentsPart.comments.get", receiver: ref("part"), arguments: {}, resultHandle: "after" },
    { operation: "model.comments.Comments.__len__.get", receiver: ref("after"), arguments: {} }
  ];
  let output: Uint8Array;
  if (route === "model") {
    const document = await product.Document(input, context), part = document.part.part_related_by(relationship);
    if (!(part instanceof product.CommentsPart)) throw new Error("Missing native comments part");
    expect(part.comments.length).toBe(2);
    const root = part.element;
    if (action === "insert") root.insert(2, node);
    else if (action === "remove") root.children[1]!.remove();
    else root.children[1]!.set_attribute({ namespaceURI: word, localName: "author" }, "Updated");
    expect(part.comments.length).toBe(count);
    expect(part.comments.get(7)!.author).toBe("Archive");
    expect(document.comments.length).toBe(count);
    await document.save({ async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } });
    output = new Uint8Array(memory.readFileSync("/output") as Buffer);
  } else if (route === "sdk") {
    const result = await product.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } });
    expect(result.results.at(-1)!.data).toBe(count);
    output = new Uint8Array(memory.readFileSync("/output") as Buffer);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try { const response = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(0); expect(JSON.parse(response.stdout).data.results.at(-1).data).toBe(count); output = await fs.readFile("/output"); expect(await fs.readFile("/input")).toEqual(original); } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original);
  const saved = readPackage(output);
  for (const [name, bytes] of parts) if (name !== "word/comments.xml") expect(saved.get(name), name).toEqual(bytes);
  const reopened = await product.Document(output, context);
  expect(reopened.comments.length).toBe(count); expect(reopened.comments.get(7)!.text).toBe("Original");
  if (action === "author") expect(reopened.comments.get(42)!.author).toBe("Updated");
  if (action === "insert") expect(reopened.comments.get(43)!.author).toBe("Independent");
  if (action === "remove") expect(reopened.comments.get(42)).toBeNull();
});
