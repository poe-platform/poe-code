import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const count of [1024, 131072]) for (const route of ["sdk", "cli"] as const)
it(`custom property ID allocation preserves admitted physical fanout; strict=${strict}; kind=${kind}; count=${count}; route=${route}`, async () => {
  const office = strict ? "http://purl.oclc.org/ooxml/officeDocument/" : "http://schemas.openxmlformats.org/officeDocument/2006/";
  const namespace = office + (strict ? "customProperties" : "custom-properties");
  const opaque = `<p:property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Retained opaque"><v:vector size="${count}" baseType="lpwstr">${"<v:lpwstr/>".repeat(count)}</v:vector></p:property>`;
  const seed = await api.readArchive(await textFixture('<w:p><w:r><w:t>Retained海🌊</w:t></w:r></w:p>', {}, strict, { kind }), textContext);
  const typesMember = seed.members.find(member => member.name === "[Content_Types].xml")!, types = new api.DocumentXmlEditor(typesMember.bytes);
  types.insertChildren(types.root, '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/metadata/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>');
  const edgesMember = seed.members.find(member => member.name === "_rels/.rels")!, edges = new api.DocumentXmlEditor(edgesMember.bytes);
  edges.insertChildren(edges.root, `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="Custom" Type="${office}relationships/custom-properties" Target="metadata/custom.xml"/>`);
  const limits = { ...textContext.limits, maxArchiveBytes: 4194304, maxEntryBytes: 2097152, maxTotalBytes: 4194304, maxRetainedBytes: 2147483648 };
  const documentLimits = { retainedBytes: 2147483648, work: 2147483648 };
  const signal = new AbortController().signal;
  const context = { ...textContext, signal, limits, budget: new api.DocumentBudget(documentLimits, signal), encoding: { order: "input", compression: "store" } as const };
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ ...seed, members: [...seed.members.map(member => member === typesMember ? { ...member, bytes: types.serialize() } : member === edgesMember ? { ...member, bytes: edges.serialize() } : member), { name: "metadata/custom.xml", bytes: enc(`<p:Properties xmlns:p="${namespace}" xmlns:v="${office}docPropsVTypes">${opaque}<!--retain--><?audit exact?></p:Properties>`), directory: false, modified: new Date("1980-01-01T00:00:00Z") }] }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = readPackage(input, limits);
  if (route === "sdk") {
    const result = await api.editDocumentProperties(input, { operation: "properties.set", name: "custom:Fresh", type: "boolean", value: false, output: "-" }, { ...context, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    expect(result).toMatchObject({ changed: true, changes: [{ kind: "add" }] });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", enc("Retained destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits }) }));
    try { const result = await shell.exec("docx properties set /input --name custom:Fresh --type boolean --value false --output /destination --force --json"); expect(Buffer.compare(Buffer.from(await fs.readFile("/input")), Buffer.from(input))).toBe(0); if (result.exitCode !== 0) expect(await fs.readFile("/destination")).toEqual(enc("Retained destination")); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, affected: 1, errors: [] }); memory.writeFileSync("/output", await fs.readFile("/destination")); } finally { await shell.dispose(); }
  }
  const saved = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer), limits);
  expect([...saved.keys()]).toEqual([...before.keys()]);
  for (const [name, bytes] of before) if (name !== "metadata/custom.xml") expect(saved.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(saved.get("metadata/custom.xml")!);
  expect(xml).toContain(opaque); expect(xml).toContain("<!--retain--><?audit exact?>");
  const editor = new api.DocumentXmlEditor(saved.get("metadata/custom.xml")!, {}, undefined, new api.DocumentBudget(documentLimits, signal));
  const fresh = editor.root.children.find(node => node.attributes.some(attribute => attribute.namespace === "" && attribute.localName === "name" && attribute.value === "Fresh"))!;
  expect(fresh.attributes.find(attribute => attribute.namespace === "" && attribute.localName === "pid")?.value).toBe("3");
  expect(fresh.children[0]).toMatchObject({ namespace: office + "docPropsVTypes", localName: "bool", text: "false" });
  expect(Buffer.compare(memory.readFileSync("/input") as Buffer, Buffer.from(input))).toBe(0);
});
