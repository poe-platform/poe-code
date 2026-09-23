import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { expect, it } from "vitest";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { encodeWholeXmlFixture } from "../tests/fixtures/whole-xml-codec.js";
import { readPackage } from "../tests/assertions.js";

const compiled = await compiledPublicRuntime;
const widths = [
  ["i1", "-128", "127"], ["i2", "-32768", "32767"],
  ["i4", "-2147483648", "2147483647"], ["int", "-2147483648", "2147483647"],
  ["i8", "-9007199254740991", "9007199254740991"],
  ["ui1", "0", "255"], ["ui2", "0", "65535"],
  ["ui4", "0", "4294967295"], ["uint", "0", "4294967295"],
  ["ui8", "0", "9007199254740991"]
] as const;
const cases = [
  ...widths.flatMap(([variant, minimum, maximum]) => [
    { variant, raw: minimum, valid: true, boundary: "safe-minimum" },
    { variant, raw: maximum, valid: true, boundary: "safe-maximum" }
  ]),
  ...[
    ["i8", "-9223372036854775808", "native-minimum"],
    ["i8", "-9223372036854775809", "below-native-minimum"],
    ["i8", "9223372036854775807", "native-maximum"],
    ["i8", "9223372036854775808", "above-native-maximum"],
    ["ui8", "18446744073709551615", "native-maximum"],
    ["ui8", "18446744073709551616", "above-native-maximum"]
  ].map(([variant, raw, boundary]) => ({ variant: variant!, raw: raw!, valid: false, boundary: boundary! }))
];

for (const runtime of ["source", "compiled"] as const)
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf8bom", "utf16le", "utf16be"] as const)
for (const item of cases) for (const route of ["model", "sdk", "cli"] as const)
it(`retained property width mutation/native64; runtime=${runtime}; strict=${strict}; kind=${kind}; codec=${codec}; variant=${item.variant}; boundary=${item.boundary}; route=${route}`, async () => {
  const api = runtime === "source" ? source : compiled;
  const office = strict ? "http://purl.oclc.org/ooxml/officeDocument/" : "http://schemas.openxmlformats.org/officeDocument/2006/";
  const custom = office + (strict ? "customProperties" : "custom-properties");
  const name = "native/width-metadata.xml", fmtid = "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}";
  const selected = `<p:property fmtid="${fmtid}" pid="2" name="Audit"><v:${item.variant}>${item.raw}</v:${item.variant}></p:property>`;
  const xml = `<p:Properties xmlns:p="${custom}" xmlns:v="${office}docPropsVTypes">${selected}<p:property fmtid="${fmtid}" pid="4" name="Opaque"><v:vector size="1" baseType="lpwstr"><v:lpwstr>Keep海🌊</v:lpwstr></v:vector></p:property><!--keep--><?audit exact?></p:Properties>`;
  const parts = readPackage(await textFixture("<w:p><w:r><w:t>Unrelated 海🌊</w:t></w:r></w:p>", {}, strict, { kind }));
  const types = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!);
  types.insertChildren(types.root, `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>`);
  parts.set("[Content_Types].xml", types.serialize());
  const rels = new api.DocumentXmlEditor(parts.get("_rels/.rels")!);
  rels.insertChildren(rels.root, `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="nativeWidth" Type="${office}relationships/custom-properties" Target="${name}"/>`);
  parts.set("_rels/.rels", rels.serialize()); parts.set(name, new TextEncoder().encode(xml));
  const memory = Volume.fromJSON({ "/authored": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/authored", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = await encodeWholeXmlFixture(new Uint8Array(memory.readFileSync("/authored") as Buffer), codec);
  const originals = readPackage(input), decode = (bytes: Uint8Array) => new TextDecoder(codec === "utf16le" ? "utf-16le" : codec === "utf16be" ? "utf-16be" : "utf8", { fatal: true }).decode(bytes);
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const context = { ...textContext, author: "", timestamp: new Date("2001-02-03T04:05:06.900Z"), encoding: { order: "input", compression: "store" } as const, stdout: sink };
  const inspection = await api.inspectDocumentProperties(input, { name: "custom:Audit" }, context);
  expect(inspection.items[0]).toMatchObject({ support: item.valid ? "edit" : "preserve", details: { id: "2", storedType: { namespace: office + "docPropsVTypes", localName: item.variant } }, references: [{ owner: "/", id: "nativeWidth", external: false }], properties: [{ type: "integer", value: item.valid ? Number(item.raw) : null, writable: item.valid }] });
  if (!item.valid) expect(inspection.warnings).toContainEqual(expect.objectContaining({ code: "invalid-property" }));
  const verify = (bytes: Uint8Array, expectedXml: string) => {
    const saved = readPackage(bytes);
    expect([...saved.keys()]).toEqual([...originals.keys()]);
    expect(decode(saved.get(name)!)).toBe(expectedXml);
    const prefix = codec === "utf8bom" ? [0xef, 0xbb, 0xbf] : codec === "utf16le" ? [0xff, 0xfe] : codec === "utf16be" ? [0xfe, 0xff] : [];
    if (prefix.length) expect([...saved.get(name)!.subarray(0, prefix.length)]).toEqual(prefix);
    for (const [part, original] of originals) if (part !== name) expect(saved.get(part), part).toEqual(original);
  };
  if (route === "model") {
    const document = await api.Document(input, context);
    await document.save(sink); expect(new Uint8Array(memory.readFileSync("/output") as Buffer)).toEqual(input);
    memory.writeFileSync("/output", ""); document.core_properties.title = "Unrelated title"; await document.save(sink);
    const saved = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
    expect(saved.get(name)).toEqual(originals.get(name));
    for (const [part, original] of originals) if (!["[Content_Types].xml", "_rels/.rels"].includes(part)) expect(saved.get(part), part).toEqual(original);
    const edges = new api.DocumentXmlEditor(saved.get("_rels/.rels")!);
    expect(edges.root.children.find(node => node.attributes.some(attribute => attribute.localName === "Id" && attribute.value === "nativeWidth"))?.attributes.map(attribute => [attribute.localName, attribute.value])).toEqual(new api.DocumentXmlEditor(originals.get("_rels/.rels")!).root.children.find(node => node.attributes.some(attribute => attribute.localName === "Id" && attribute.value === "nativeWidth"))?.attributes.map(attribute => [attribute.localName, attribute.value]));
  } else if (route === "sdk") {
    for (const action of ["same", "dirty", "remove"] as const) {
      memory.writeFileSync("/output", "");
      const options = action === "remove" ? { operation: "properties.remove" as const, name: "custom:Audit", output: "-" } : { operation: "properties.set" as const, name: "custom:Audit", value: action === "same" && item.valid ? Number(item.raw) : 8, output: "-" };
      const pending = api.editDocumentProperties(input, options, context);
      if (!item.valid) { await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" }); expect(memory.statSync("/output").size).toBe(0); }
      else {
        const result = await pending; expect(result.changed).toBe(action !== "same");
        const bytes = new Uint8Array(memory.readFileSync("/output") as Buffer);
        if (action === "same") expect(bytes).toEqual(input);
        verify(bytes, action === "remove" ? xml.replace(selected, "") : action === "dirty" ? xml.replace(`>${item.raw}</v:${item.variant}>`, `>8</v:${item.variant}>`) : xml);
      }
    }
  } else {
    const fs = new MemoryFileSystem(), retained = new TextEncoder().encode("Retained destination");
    await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const read = await shell.exec("docx properties get /input --name custom:Audit --json");
      expect(read.exitCode, read.stdout + read.stderr).toBe(0); expect(JSON.parse(read.stdout).data.item.properties[0].value).toBe(item.valid ? Number(item.raw) : null);
      for (const action of ["same", "dirty", "remove"] as const) {
        await fs.writeFile("/destination", retained);
        const result = await shell.exec(`docx properties ${action === "remove" ? "remove" : "set"} /input --name custom:Audit${action === "remove" ? "" : ` --value ${action === "same" && item.valid ? Number(item.raw) : 8}`} --output /destination --force --json`);
        expect(result.exitCode, result.stdout + result.stderr).toBe(item.valid ? 0 : 1);
        if (!item.valid) { expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] }); expect(await fs.readFile("/destination")).toEqual(retained); }
        else { expect(JSON.parse(result.stdout).affected).toBe(action === "same" ? 0 : 1); const bytes = await fs.readFile("/destination"); if (action === "same") expect(bytes).toEqual(input); verify(bytes, action === "remove" ? xml.replace(selected, "") : action === "dirty" ? xml.replace(`>${item.raw}</v:${item.variant}>`, `>8</v:${item.variant}>`) : xml); }
        expect(await fs.readFile("/input")).toEqual(input);
      }
    } finally { await shell.dispose(); }
  }
  expect(new Uint8Array(memory.readFileSync("/authored") as Buffer)).not.toHaveLength(0);
});
