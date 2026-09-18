import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
const ref = (resultHandle: string) => ({ resultHandle });
const binary = (bytes: Uint8Array) => ({ kind: "bytes", base64: Buffer.from(bytes).toString("base64") });
const context = { ...textContext, timestamp: new Date("2026-01-02T03:04:06Z"), author: "Estuary archive", encoding: { order: "input", compression: "store" } as const };
type Step = { operation: string; receiver?: ReturnType<typeof ref>; arguments: Record<string, unknown>; resultHandle?: string };

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["package.Package", "opc.package.OpcPackage"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} opens and traverses ${owner} with allocated parts and owned properties; ${kind} strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, "<w:p><w:r><w:t>Estuary records</w:t></w:r></w:p>");
  const before = readPackage(input), prefix = "model." + owner, payload = Uint8Array.of(0, 23, 255, 128);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/output", bytes); } };
  const operations: Step[] = [
    { operation: prefix + ".open.call", arguments: { pkgFile: binary(input) }, resultHandle: "opened" },
    { operation: prefix + ".main_document_part.get", receiver: ref("opened"), arguments: {}, resultHandle: "readMain" },
    { operation: "model.opc.part.Part.blob.get", receiver: ref("readMain"), arguments: {} },
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.opc.part.Part.package.get", receiver: ref("main"), arguments: {}, resultHandle: "package" }
  ];
  const expected = new Map<number, unknown>([[2, binary(before.get("word/document.xml")!)]]);
  const step = (member: string, args: Record<string, unknown> = {}, resultHandle?: string) => {
    operations.push({ operation: prefix + "." + member, receiver: ref("package"), arguments: args, ...(resultHandle ? { resultHandle } : {}) });
    return operations.length - 1;
  };
  expected.set(step("after_unmarshal.call"), null); expected.set(step("next_partname.call", { template: "/records/item%d.bin" }), "/records/item1.bin");
  operations.push({ operation: "model.opc.part.Part.load.call", arguments: { partname: "/records/item1.bin", contentType: "application/octet-stream", blob: binary(payload), ownerPackage: ref("package") }, resultHandle: "item" });
  expected.set(step("load_rel.call", { reltype: "urn:estuary:record", target: ref("item"), rId: "record" }), null);
  expected.set(step("relate_to.call", { part: ref("item"), reltype: "urn:estuary:record" }), "record");
  step("part_related_by.call", { reltype: "urn:estuary:record" }, "related");
  operations.push({ operation: "model.opc.part.Part.blob.get", receiver: ref("related"), arguments: {} }); expected.set(operations.length - 1, binary(payload));
  const partsIndex = step("parts.get"), iterIndex = step("iter_parts.call"), edgesIndex = step("iter_rels.call");
  step("rels.get", {}, "rels");
  operations.push({ operation: "model.opc.rel.Relationships.keys.call", receiver: ref("rels"), arguments: {} });
  const keysIndex = operations.length - 1;
  expected.set(step("next_partname.call", { template: "/records/item%d.bin" }), "/records/item2.bin");
  step("core_properties.get", {}, "properties");
  operations.push({ operation: "model.opc.coreprops.CoreProperties.title.get", receiver: ref("properties"), arguments: {} }); expected.set(operations.length - 1, "Document");
  operations.push({ operation: "model.opc.coreprops.CoreProperties.title.set", receiver: ref("properties"), arguments: { value: "Estuary index" } });
  operations.push({ operation: "model.opc.coreprops.CoreProperties.title.get", receiver: ref("properties"), arguments: {} }); expected.set(operations.length - 1, "Estuary index");
  expected.set(step("after_unmarshal.call"), null);
  const tree = xmlStructure(before.get("_rels/.rels")!);
  const walk = (node: typeof tree): typeof tree[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : walk(child))];
  const originalEdges = walk(tree).filter(node => node.name.endsWith("}Relationship")).map(node => node.attributes);
  expected.set(keysIndex, [...originalEdges.map(edge => edge["{}Id"]), "record"]);
  if (route === "model") {
    const pending = api.PackageView.open(input, context); expect(pending).toBeInstanceOf(Promise);
    const opened = await pending; expect(opened.main_document_part.blob).toEqual(before.get("word/document.xml"));
    const doc = await api.Document(input, context), pkg = doc.part.package;
    expect(pkg.after_unmarshal()).toBeUndefined(); expect(String(pkg.next_partname("/records/item%d.bin"))).toBe("/records/item1.bin");
    const item = await api.PartView.load("/records/item1.bin", "application/octet-stream", payload, pkg);
    expect(pkg.load_rel("urn:estuary:record", item, "record")).toBeUndefined(); expect(pkg.relate_to(item, "urn:estuary:record")).toBe("record");
    expect(pkg.part_related_by("urn:estuary:record")).toBe(item); expect(pkg.parts).toEqual([doc.part, item]); expect([...pkg.iter_parts()]).toEqual([doc.part, item]);
    expect([...pkg.iter_rels()].map(edge => edge.rId)).toEqual(expected.get(keysIndex)); expect([...pkg.rels.keys()]).toEqual(expected.get(keysIndex));
    expect(String(pkg.next_partname("/records/item%d.bin"))).toBe("/records/item2.bin");
    const core = pkg.core_properties; expect(core.title).toBe("Document"); expect(core.part.package).toBe(pkg); core.title = "Estuary index";
    expect(pkg.core_properties).toBe(core); expect(core.modified?.toISOString()).toBe("2026-01-02T03:04:06.000Z");
    expect(pkg.after_unmarshal()).toBeUndefined(); expect(pkg.main_document_part).toBe(doc.part); await pkg.save(sink);
  } else if (route === "sdk") {
    const result = await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-", timestamp: context.timestamp.toISOString(), author: context.author }, { ...context, stdout: sink });
    for (const [index, value] of expected) expect(result.results[index]!.data, operations[index]!.operation).toEqual(value);
    expect(result.results[partsIndex]!.data).toEqual([expect.objectContaining({ type: "DocumentPart" }), expect.objectContaining({ type: "PartView" })]);
    expect(result.results[iterIndex]!.data).toEqual(result.results[partsIndex]!.data); expect(result.results[edgesIndex]!.data).toHaveLength(2);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const response = await shell.exec("docx batch /input --ops-file /ops --output /output --timestamp 2026-01-02T03:04:06Z --author 'Estuary archive' --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(0);
      const result = JSON.parse(response.stdout); for (const [index, value] of expected) expect(result.data.results[index].data, operations[index]!.operation).toEqual(value);
      expect(result.data.results[partsIndex].data).toEqual([expect.objectContaining({ type: "DocumentPart" }), expect.objectContaining({ type: "PartView" })]);
      expect(result.data.results[iterIndex].data).toEqual(result.data.results[partsIndex].data); expect(result.data.results[edgesIndex].data).toHaveLength(2);
      volume.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of before) if (!["[Content_Types].xml", "_rels/.rels"].includes(name)) expect(saved.get(name), name).toEqual(bytes);
  expect(saved.get("records/item1.bin")).toEqual(payload);
  const afterEdges = walk(xmlStructure(saved.get("_rels/.rels")!)).filter(node => node.name.endsWith("}Relationship")).map(node => node.attributes);
  expect(afterEdges.slice(0, originalEdges.length)).toEqual(originalEdges); expect(afterEdges).toHaveLength(originalEdges.length + 2);
  expect(afterEdges[originalEdges.length]).toEqual({ "{}Id": "record", "{}Type": "urn:estuary:record", "{}Target": "records/item1.bin" });
  const reopened = await api.Document(output, context); expect(reopened.core_properties.title).toBe("Estuary index");
  expect(reopened.part.content_type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml." + (kind === "docx" ? "document" : "template") + ".main+xml");
  expect(reopened.part.element.namespace).toBe(strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main");
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
