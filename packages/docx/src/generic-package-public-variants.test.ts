import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const binary = (bytes: Uint8Array) => ({ kind: "bytes", base64: Buffer.from(bytes).toString("base64") });
const context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
type Step = { operation: string; receiver?: ReturnType<typeof ref>; arguments: Record<string, unknown>; resultHandle?: string };

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const xml of [false, true]) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} retains generic ${xml ? "XmlPart" : "Part"} factory, graph and renamed payload; ${kind} strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, "<w:p><w:r><w:t>Estuary survey</w:t></w:r></w:p>");
  const payload = xml ? enc('<?xml version="1.0"?><!--prolog--><audit xmlns="urn:estuary:audit" xml:space="preserve">  coast <label>delta</label> tail </audit><?retain exact?>') : Uint8Array.of(0, 255, 34, 128, 10);
  const type = xml ? "application/xml;origin=estuary" : "application/octet-stream";
  const name = xml ? "/records/audit.xml" : "/records/audit.bin", renamed = xml ? "/moved/audit.xml" : "/moved/audit.bin";
  const prefix = xml ? "model.opc.part.XmlPart" : "model.opc.part.Part";
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/output", bytes); } };
  const operations: Step[] = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.opc.part.Part.package.get", receiver: ref("main"), arguments: {}, resultHandle: "package" },
    { operation: prefix + ".load.call", arguments: { partname: name, contentType: type, blob: binary(payload), ownerPackage: ref("package") }, resultHandle: "part" }
  ];
  const expected = new Map<number, unknown>();
  const step = (member: string, args: Record<string, unknown> = {}, resultHandle?: string) => {
    operations.push({ operation: prefix + "." + member, receiver: ref("part"), arguments: args, ...(resultHandle ? { resultHandle } : {}) });
    return operations.length - 1;
  };
  expected.set(step("after_unmarshal.call"), null); expected.set(step("before_marshal.call"), null);
  expected.set(step("blob.get"), binary(payload)); expected.set(step("content_type.get"), type); expected.set(step("partname.get"), name);
  step("package.get", {}, "samePackage");
  operations.push({ operation: "model.opc.package.OpcPackage.main_document_part.get", receiver: ref("samePackage"), arguments: {}, resultHandle: "sameMain" });
  operations.push({ operation: "model.opc.part.Part.partname.get", receiver: ref("sameMain"), arguments: {} }); expected.set(operations.length - 1, "/word/document.xml");
  expected.set(step("related_parts.get"), []); step("rels.get", {}, "rels");
  operations.push({ operation: "model.opc.rel.Relationships.__len__.get", receiver: ref("rels"), arguments: {} }); expected.set(operations.length - 1, 0);
  expected.set(step("load_rel.call", { reltype: "urn:estuary:outside", target: "file:///never-acquire/estuary", rId: "outside", isExternal: true }), null);
  expected.set(step("relate_to.call", { target: "file:///never-acquire/estuary", reltype: "urn:estuary:outside", isExternal: true }), "outside");
  expected.set(step("relate_to.call", { target: ref("main"), reltype: "urn:estuary:main" }), "rId1");
  expected.set(step("target_ref.call", { rId: "rId1" }), "../word/document.xml");
  step("part_related_by.call", { reltype: "urn:estuary:main" }, "related");
  operations.push({ operation: "model.opc.part.Part.partname.get", receiver: ref("related"), arguments: {} }); expected.set(operations.length - 1, "/word/document.xml");
  const mapIndex = step("related_parts.get");
  expected.set(step("partname.set", { value: renamed }), null); expected.set(step("partname.get"), renamed);
  expected.set(step("drop_rel.call", { rId: "rId1" }), null); expected.set(step("related_parts.get"), []);
  if (xml) {
    step("part.get", {}, "samePart");
    operations.push({ operation: prefix + ".partname.get", receiver: ref("samePart"), arguments: {} }); expected.set(operations.length - 1, renamed);
    step("element.get", {}, "element");
    operations.push({ operation: "model.XmlElementView.tag.get", receiver: ref("element"), arguments: {} }); expected.set(operations.length - 1, { namespaceURI: "urn:estuary:audit", localName: "audit" });
  }
  if (route === "model") {
    const doc = await api.Document(input, context), Factory = xml ? api.XmlPartView : api.PartView;
    const pending = Factory.load(name, type, payload, doc.part.package); expect(pending).toBeInstanceOf(Promise);
    const part = await pending; expect(part).toBeInstanceOf(Factory); expect(part.package).toBe(doc.part.package);
    expect(part.after_unmarshal()).toBeUndefined(); expect(part.before_marshal()).toBeUndefined();
    expect(part.blob).toEqual(payload); const copy = part.blob; copy.fill(17); expect(part.blob).toEqual(payload);
    expect(part.content_type).toBe(type); expect(String(part.partname)).toBe(name); expect(part.related_parts.size).toBe(0); expect(part.rels.length).toBe(0);
    expect(part.load_rel("urn:estuary:outside", "file:///never-acquire/estuary", "outside", true)).toBeUndefined();
    expect(part.relate_to("file:///never-acquire/estuary", "urn:estuary:outside", true)).toBe("outside");
    expect(part.relate_to(doc.part, "urn:estuary:main")).toBe("rId1"); expect(part.target_ref("rId1")).toBe("../word/document.xml");
    expect(part.part_related_by("urn:estuary:main")).toBe(doc.part); expect([...part.related_parts]).toEqual([["rId1", doc.part]]);
    const held = part.rels; part.partname = renamed; expect(held.at("outside").target_ref).toBe("file:///never-acquire/estuary");
    expect(part.drop_rel("rId1")).toBeUndefined(); expect(part.related_parts.size).toBe(0);
    if (part instanceof api.XmlPartView) { expect(part.part).toBe(part); expect(part.element.tag).toEqual({ namespaceURI: "urn:estuary:audit", localName: "audit" }); }
    await doc.save(sink);
  } else if (route === "sdk") {
    const result = await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: sink });
    for (const [index, value] of expected) expect(result.results[index]!.data, operations[index]!.operation).toEqual(value);
    expect(result.results[mapIndex]!.data).toEqual([{ key: "rId1", value: expect.objectContaining({ type: "DocumentPart" }) }]);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const response = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(0);
      const result = JSON.parse(response.stdout); for (const [index, value] of expected) expect(result.data.results[index].data, operations[index]!.operation).toEqual(value);
      expect(result.data.results[mapIndex].data).toEqual([{ key: "rId1", value: expect.objectContaining({ type: "DocumentPart" }) }]);
      volume.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [member, bytes] of readPackage(input)) if (member !== "[Content_Types].xml") expect(saved.get(member), member).toEqual(bytes);
  expect(saved.get(renamed.slice(1))).toEqual(payload); expect(saved.has(name.slice(1))).toBe(false);
  const tree = xmlStructure(saved.get("moved/_rels/audit." + (xml ? "xml" : "bin") + ".rels")!);
  const walk = (node: typeof tree): typeof tree[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : walk(child))];
  expect(walk(tree).filter(node => node.name.endsWith("}Relationship")).map(node => node.attributes)).toEqual([{ "{}Id": "outside", "{}Type": "urn:estuary:outside", "{}Target": "file:///never-acquire/estuary", "{}TargetMode": "External" }]);
  const reopened = await api.inspectDocument(output, context); expect(reopened.kind).toBe(kind); expect(reopened.dialect).toBe(strict ? "strict" : "transitional");
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
