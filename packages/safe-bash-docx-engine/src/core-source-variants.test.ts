import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { chartFixture, chartContext } from "../tests/fixtures/charts.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const cp = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const dc = "http://purl.org/dc/elements/1.1/", dt = "http://purl.org/dc/terms/";
const strings = [
  ["author", "dc:creator"], ["category", "cp:category"], ["comments", "dc:description"],
  ["content_status", "cp:contentStatus"], ["identifier", "dc:identifier"], ["keywords", "cp:keywords"],
  ["language", "dc:language"], ["last_modified_by", "cp:lastModifiedBy"], ["subject", "dc:subject"],
  ["title", "dc:title"], ["version", "cp:version"]
] as const;
const dates = [["created", "dcterms:created"], ["last_printed", "cp:lastPrinted"], ["modified", "dcterms:modified"]] as const;
type Case = { name: string; property: string; tag: string; stored: string | null; expected: string | number | null; value: string | number; date?: boolean };
const cases: Case[] = [
  ...strings.flatMap(([property, tag]) => [false, true].map(present => ({ name: `${property} ${present ? "stored" : "absent"}`, property, tag, stored: present ? "Estuary survey" : null, expected: present ? "Estuary survey" : "", value: "Coast 🌊" }))),
  ...dates.flatMap(([property, tag]) => [false, true].map(present => ({ name: `${property} ${present ? "stored" : "absent"}`, property, tag, stored: present ? "2004-03-02T01:02:03Z" : null, expected: present ? "2004-03-02T01:02:03.000Z" : null, value: "1969-12-31T23:59:59.000Z", date: true }))),
  ...["73", null, "unmeasured", "-23", "18.25"].map(stored => ({ name: `revision ${stored ?? "absent"}`, property: "revision", tag: "cp:revision", stored, expected: stored === "73" ? 73 : 0, value: 29 }))
];
const enc = (value: string) => new TextEncoder().encode(value), ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const route of ["model", "sdk", "shell"] as const)
it.each(cases)(`${route} reads and changes core $name with retained metadata; ${kind} strict=${strict}`, async sample => {
  const attr = sample.date && sample.tag.startsWith("dcterms:") ? ' xsi:type="dcterms:W3CDTF"' : "";
  const value = sample.stored === null ? "" : `<${sample.tag}${attr}>${sample.stored}</${sample.tag}>`;
  const xml = `<?record retain?><cp:coreProperties xmlns:cp="${cp}" xmlns:dc="${dc}" xmlns:dcterms="${dt}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n<!--unselected evidence-->${value}\n<?end retain?></cp:coreProperties>`;
  const parts = readPackage(await chartFixture({ strict, definitions: [], body: "<w:p><w:r><w:t>Coast</w:t></w:r></w:p>", resources: [{ name: "metadata/core.xml", type: "application/vnd.openxmlformats-package.core-properties+xml", bytes: xml }], relationships: [{ owner: "/", id: "metadata", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "metadata/core.xml" }] }));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), context = { ...chartContext, encoding: { order: "input", compression: "store" } as const };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const operations = [
    { operation: "model.document.Document.core_properties.get", receiver: ref("document"), arguments: {}, resultHandle: "core" },
    { operation: `model.opc.coreprops.CoreProperties.${sample.property}.get`, receiver: ref("core"), arguments: {} },
    { operation: `model.opc.coreprops.CoreProperties.${sample.property}.set`, receiver: ref("core"), arguments: { value: sample.value } },
    { operation: `model.opc.coreprops.CoreProperties.${sample.property}.get`, receiver: ref("core"), arguments: {} }
  ];
  const normalized = (value: unknown) => value instanceof Date ? value.toISOString() : value;
  if (route === "model") {
    const document = await api.Document(input, context), core = document.core_properties as unknown as Record<string, unknown>;
    expect(normalized(core[sample.property])).toBe(sample.expected); expect(document.core_properties.part.blob).toEqual(parts.get("metadata/core.xml"));
    core[sample.property] = sample.date ? new Date(sample.value) : sample.value;
    expect(normalized(core[sample.property])).toBe(sample.value); await document.save(sink);
  } else if (route === "sdk") {
    const result = await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: sink });
    expect(result.results[1]!.data).toBe(sample.expected); expect(result.results[3]!.data).toBe(sample.value);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const envelope = JSON.parse(result.stdout); expect(envelope.data.results[1].data).toBe(sample.expected); expect(envelope.data.results[3].data).toBe(sample.value);
      memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of parts) if (name !== "metadata/core.xml") expect(saved.get(name), name).toEqual(bytes);
  const savedXml = new TextDecoder().decode(saved.get("metadata/core.xml")!);
  for (const trivia of ["<?record retain?>", "<!--unselected evidence-->", "<?end retain?>"]) expect(savedXml).toContain(trivia);
  const walk = (node: ReturnType<typeof xmlStructure>): ReturnType<typeof xmlStructure>[] => [node, ...node.children.flatMap(c => typeof c === "string" ? [] : walk(c))];
  const namespace = sample.tag.startsWith("dc:") ? dc : sample.tag.startsWith("dcterms:") ? dt : cp;
  const nodes = walk(xmlStructure(saved.get("metadata/core.xml")!)).filter(node => node.name === `{${namespace}}${sample.tag.split(":")[1]}`);
  expect(nodes).toHaveLength(1); expect(nodes[0]!.children).toEqual([sample.date ? String(sample.value).replace(".000Z", "Z") : String(sample.value)]);
  if (sample.date && sample.tag.startsWith("dcterms:")) expect(nodes[0]!.attributes["{http://www.w3.org/2001/XMLSchema-instance}type"]).toBe("dcterms:W3CDTF");
  const reopened = await api.Document(output, context); expect(normalized((reopened.core_properties as unknown as Record<string, unknown>)[sample.property])).toBe(sample.value);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
