import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const native = await compiledPublicRuntime;
const metadata = [
  { name: "thread", kind: "commentsExtended", namespace: "http://schemas.microsoft.com/office/word/2012/wordml", root: "commentsEx", entry: "commentEx", relationship: "http://schemas.microsoft.com/office/2011/relationships/commentsExtended", attributes: 'm:paraId="000000A1" m:done="0"', field: "done", before: "0", after: "1" },
  { name: "ids", kind: "commentsIds", namespace: "http://schemas.microsoft.com/office/word/2016/wordml/cid", root: "commentsIds", entry: "commentId", relationship: "http://schemas.microsoft.com/office/2016/09/relationships/commentsIds", attributes: 'm:paraId="000000A1" m:durableId="00000011"', field: "durableId", before: "00000011", after: "00000022" },
  { name: "extra", kind: "commentsExtensible", namespace: "http://schemas.microsoft.com/office/word/2018/wordml/cex", root: "commentsExtensible", entry: "commentExtensible", relationship: "http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible", attributes: 'm:durableId="00000011" m:dateUtc="2026-01-02T03:04:05Z"', field: "dateUtc", before: "2026-01-02T03:04:05Z", after: "2026-02-03T04:05:06Z" },
  { name: "authors", kind: "people", namespace: "http://schemas.microsoft.com/office/word/2012/wordml", root: "people", entry: "person", relationship: "http://schemas.microsoft.com/office/2011/relationships/people", attributes: 'm:author="Archive"', field: "author", before: "Archive", after: "Updated" }
];
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const runtime of ["source", "native"] as const) for (const route of ["model", "sdk", "cli"] as const)
for (const target of metadata) for (const mode of ["edit", "noop", "inert"] as const)
for (const media of ["native", "generic", "uppercase", "parameter"] as const)
it(`modern metadata parts remain preserve-only through public XML views; strict=${strict}; kind=${kind}; codec=${codec}; runtime=${runtime}; route=${route}; target=${target.kind}; mode=${mode}; media=${media}`, async () => {
  const product: typeof api = runtime === "native" ? native : api;
  const context = { limits: textContext.limits, signal: textContext.signal, encoding: { order: "input", compression: "store" } as const };
  const namespace = mode === "inert" ? "urn:original:inert-metadata" : target.namespace;
  const relationship = mode === "inert" ? "urn:original:inert-resource" : target.relationship;
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Outside</w:t></w:r></w:p>', {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}" xmlns:p="http://schemas.microsoft.com/office/word/2010/wordml"><w:comment w:id="7" w:author="Archive"><w:p p:paraId="000000A1"><w:r><w:t>Original</w:t></w:r></w:p></w:comment></w:comments>` },
    ...Object.fromEntries(metadata.map(item => [item.name, { kind: item.kind, xml: `<m:${item.root} xmlns:m="${item === target ? namespace : item.namespace}"><m:${item.entry} ${item.attributes}/><!--retained--><?audit exact?></m:${item.root}>` }]))
  }, strict, { kind }));
  const edges = new product.DocumentXmlEditor(parts.get("word/_rels/document.xml.rels")!);
  for (const item of metadata) edges.setAttribute(edges.root.children.find(node => node.attributes.some(a => a.localName === "Id" && a.value === item.name))!, "Type", item === target ? relationship : item.relationship);
  parts.set("word/_rels/document.xml.rels", edges.serialize());
  if (mode === "inert" || media !== "native") {
    const types = new product.DocumentXmlEditor(parts.get("[Content_Types].xml")!);
    const baseType = mode === "inert" || media === "generic" ? "application/xml" : `application/vnd.openxmlformats-officedocument.wordprocessingml.${target.kind}+xml`;
    const type = media === "uppercase" ? baseType.toUpperCase() : media === "parameter" ? baseType + "; audit=Exact" : baseType;
    types.setAttribute(types.root.children.find(node => node.attributes.some(a => a.localName === "PartName" && a.value === `/word/${target.name}.xml`))!, "ContentType", type);
    parts.set("[Content_Types].xml", types.serialize());
  }
  if (codec !== "utf8") for (const [name, bytes] of parts) {
    const encoded = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le");
    if (codec === "utf16be") encoded.swap16();
    parts.set(name, new Uint8Array(encoded));
  }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice(), value = mode === "noop" ? target.before : target.after;
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("main"), arguments: { reltype: relationship }, resultHandle: "part" },
    { operation: "model.opc.part.XmlPart.element.get", receiver: ref("part"), arguments: {}, resultHandle: "root" },
    { operation: "model.XmlElementView.children.get", receiver: ref("root"), arguments: {}, resultHandle: "entries" },
    { operation: "model.XmlElementView.set_attribute.call", receiver: ref("entries", 0), arguments: { name: { namespaceURI: namespace, localName: target.field }, value } }
  ];
  let output: Uint8Array | undefined;
  if (route === "model") {
    const document = await product.Document(input, context), part = document.part.part_related_by(relationship);
    expect(part).toBeInstanceOf(product.XmlPartView);
    if (!(part instanceof product.XmlPartView)) throw new Error("Missing public XML part");
    const mutate = () => part.element.children[0]!.set_attribute({ namespaceURI: namespace, localName: target.field }, value);
    if (mode === "edit") expect(mutate).toThrowError(expect.objectContaining({ code: "unsupported-edit" })); else mutate();
    await document.save({ async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } });
    output = new Uint8Array(memory.readFileSync("/output") as Buffer);
    if (mode !== "inert") expect(output).toEqual(original);
  } else if (route === "sdk") {
    const pending = product.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } });
    if (mode === "edit") { await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" }); expect(memory.statSync("/output").size).toBe(0); }
    else { await pending; output = new Uint8Array(memory.readFileSync("/output") as Buffer); }
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination");
    await fs.writeFile("/input", input); await fs.writeFile("/output", destination); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const response = await shell.exec("docx batch /input --ops-file /ops --output /output --force --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(mode === "edit" ? 1 : 0);
      if (mode === "edit") { expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] }); expect(await fs.readFile("/output")).toEqual(destination); }
      else output = await fs.readFile("/output");
      expect(await fs.readFile("/input")).toEqual(original);
    } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original);
  if (output) {
    const saved = readPackage(output);
    expect([...saved.keys()]).toEqual([...parts.keys()]);
    if (mode === "noop") expect(output).toEqual(original);
    for (const [name, bytes] of parts) if (mode !== "inert" || name !== `word/${target.name}.xml`) expect(saved.get(name), name).toEqual(bytes);
    if (mode === "inert") expect(new product.DocumentXmlEditor(saved.get(`word/${target.name}.xml`)!).root.children[0]!.attributes.find(a => a.namespace === namespace && a.localName === target.field)!.value).toBe(target.after);
  }
});
