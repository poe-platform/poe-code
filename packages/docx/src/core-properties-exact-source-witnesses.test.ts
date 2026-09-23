import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

// Independently authored observable cases. R identities bind the researched
// scalar parameters; no source catalog or upstream fixture is imported at runtime.
const strings = [
  [171, "author", "dc:creator", "Coastal archive", "Archivist"],
  [172, "category", "cp:category", "", "silly stories"],
  [173, "comments", "dc:description", "", "Bar foo to you"],
  [174, "content_status", "cp:contentStatus", "DRAFT", "FINAL"],
  [175, "identifier", "dc:identifier", "GXS 10.2.1ab", "GT 5.2.xab"],
  [176, "keywords", "cp:keywords", "foo bar baz", "dog cat moo"],
  [177, "language", "dc:language", "US-EN", "GB-EN"],
  [178, "last_modified_by", "cp:lastModifiedBy", "Morgan Reed", "Rowan Lake"],
  [179, "subject", "dc:subject", "Spam", "Eggs"],
  [180, "title", "dc:title", "Word Document", "Dissertation"],
  [181, "version", "cp:version", "1.2.88", "81.2.8"]
] as const;
const cases = [
  ...strings.map(([row, key, tag, expected]) => ({ row, action: "string-read" as const, key, tag, expected })),
  ...strings.map(([row, key, tag, , expected]) => ({ row: row + 11, action: "string-set" as const, key, tag, expected })),
  { row: 193, action: "date-read" as const, key: "created" as const, tag: "dcterms:created", expected: "2012-11-17T16:37:40.000Z" },
  { row: 194, action: "date-read" as const, key: "last_printed" as const, tag: "cp:lastPrinted", expected: "2014-06-04T04:28:00.000Z" },
  { row: 195, action: "date-read" as const, key: "modified" as const, tag: "dcterms:modified", expected: null },
  { row: 196, action: "date-set" as const, key: "created" as const, tag: "dcterms:created", expected: "2001-02-03T04:05:00.000Z" },
  { row: 197, action: "date-set" as const, key: "last_printed" as const, tag: "cp:lastPrinted", expected: "2014-06-04T04:00:00.000Z" },
  { row: 198, action: "date-set" as const, key: "modified" as const, tag: "dcterms:modified", expected: "2005-04-03T02:01:00.000Z" },
  ...["42", null, "foobar", "-17", "32.7"].map((raw, index) => ({ row: 199 + index, action: "revision-read" as const, key: "revision" as const, tag: "cp:revision", raw, expected: raw === "42" ? 42 : 0 })),
  { row: 204, action: "revision-set" as const, key: "revision" as const, tag: "cp:revision", expected: 42 }
];
const cp = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties", dc = "http://purl.org/dc/elements/1.1/", dt = "http://purl.org/dc/terms/", xsi = "http://www.w3.org/2001/XMLSchema-instance";
const ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const sample of cases) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} independently executes exact core-properties witness R${sample.row}; ${kind}; strict=${strict}`, async () => {
  const changing = sample.action.endsWith("-set"), readingRevision = sample.action === "revision-read";
  const fixtureValues = strings.filter(([, key]) => key !== "category").map(([, , tag, expected]) => expected ? `<${tag}>${expected}</${tag}>` : `<${tag}/>`).join("") + '<dcterms:created xsi:type="dcterms:W3CDTF">2012-11-17T11:07:40-05:30</dcterms:created><cp:lastPrinted>2014-06-04T04:28:00Z</cp:lastPrinted><cp:revision>4</cp:revision>';
  const content = changing ? "" : readingRevision ? sample.raw === null ? "" : `<cp:revision>${sample.raw}</cp:revision>` : fixtureValues;
  const nativeXml = `<cp:coreProperties xmlns:cp="${cp}" xmlns:dc="${dc}" xmlns:dcterms="${dt}" xmlns:xsi="${xsi}"><!--retain-->${content}<?audit exact?></cp:coreProperties>`;
  const initial = await textFixture('<w:p><w:r><w:t>Retained海🌊</w:t></w:r></w:p>', {}, strict, { kind }), parts = readPackage(initial), enc = (value: string) => new TextEncoder().encode(value);
  const types = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!);
  types.insertChildren(types.root, '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/metadata/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'); parts.set("[Content_Types].xml", types.serialize());
  const edges = new api.DocumentXmlEditor(parts.get("_rels/.rels")!);
  edges.insertChildren(edges.root, '<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="Core" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="metadata/core.xml"/>'); parts.set("_rels/.rels", edges.serialize()); parts.set("metadata/core.xml", enc(nativeXml));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), operations = [
    { operation: "model.document.Document.core_properties.get", receiver: ref("document"), arguments: {}, resultHandle: "core" },
    ...(changing ? [{ operation: `model.opc.coreprops.CoreProperties.${sample.key}.set`, receiver: ref("core"), arguments: { value: sample.expected } }] : []),
    { operation: `model.opc.coreprops.CoreProperties.${sample.key}.get`, receiver: ref("core"), arguments: {} }
  ];
  if (route === "model") {
    const doc = await api.Document(input, context), core = doc.core_properties;
    expect(core.part).toBeInstanceOf(api.CorePropertiesPartView);
    if (!(core.part instanceof api.CorePropertiesPartView)) throw new Error("Expected an owned core part.");
    expect(core.part.core_properties).toBe(core); expect(core.element.serialize()).toEqual(core.part.element.serialize());
    if (sample.action === "string-set") core[sample.key] = sample.expected;
    else if (sample.action === "date-set") core[sample.key] = new Date(sample.expected);
    else if (sample.action === "revision-set") core.revision = sample.expected;
    const actual = core[sample.key]; expect(actual instanceof Date ? actual.toISOString() : actual).toBe(sample.expected);
    await doc.save(sink);
  } else if (route === "sdk") {
    const result = await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: sink });
    expect(result.results.at(-1)!.data).toBe(sample.expected);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", enc("Retained destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --output /destination --force --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe(sample.expected);
      memory.writeFileSync("/output", await fs.readFile("/destination")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  for (const [name, bytes] of parts) if (!changing || name !== "metadata/core.xml") expect(after.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(after.get("metadata/core.xml")); expect(xml).toContain("<!--retain-->"); expect(xml).toContain("<?audit exact?>");
  if (changing) {
    const tree = xmlStructure(after.get("metadata/core.xml")!).children.find(child => typeof child !== "string" && child.name === `{${cp}}coreProperties`);
    if (!tree || typeof tree === "string") throw new Error("Expected a native core-properties root.");
    const namespace = sample.tag.startsWith("dc:") ? dc : sample.tag.startsWith("dcterms:") ? dt : cp;
    expect(tree.children.filter(child => typeof child !== "string" && !child.name.startsWith("#"))).toEqual([{ name: `{${namespace}}${sample.tag.split(":")[1]}`, attributes: sample.action === "date-set" && namespace === dt ? { [`{${xsi}}type`]: "dcterms:W3CDTF" } : {}, children: [sample.action === "date-set" ? sample.expected.replace(".000Z", "Z") : String(sample.expected)] }]);
  }
  const reloaded = (await api.Document(output, context)).core_properties[sample.key]; expect(reloaded instanceof Date ? reloaded.toISOString() : reloaded).toBe(sample.expected);
  expect([...after.keys()]).toEqual([...parts.keys()]); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
