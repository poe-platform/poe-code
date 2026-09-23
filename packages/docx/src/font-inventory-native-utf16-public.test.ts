import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Ajv2020 } from "ajv/dist/2020.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const api = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { textContext as fixtureContext, textFixture, w, r } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const textContext = { limits: fixtureContext.limits, signal: fixtureContext.signal };
const encode = (value: string) => new TextEncoder().encode(value);
const validator = new Ajv2020({ strict: false, validateFormats: false });
const fontSchema = api.getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "fonts.list" } })!.data as compiledTypes.DocxSchemaData;
const validateFontResult = validator.compile(fontSchema.operations[0]!.result);
const batchSchema = api.getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "batch" } })!.data as compiledTypes.DocxSchemaData;
const batchVariants = (batchSchema.operations[0]!.result.oneOf![0]!.properties!.data!.properties!.results!.items as compiledTypes.DocxJsonSchema).oneOf!;
const validateFontBatchResult = validator.compile(batchVariants.find(variant => variant.properties!.operation!.const === "fonts.list")!);
for (const codec of ["utf16le", "utf16be"] as const) {
async function fixture(strict: boolean, kind: "docx" | "dotx", parameter: string, body = '<w:p><w:r><w:t>Retained coast 海 🌊</w:t></w:r></w:p>') {
  const namespace = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const relationship = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r;
  const input = await textFixture(body, { fontTable: { kind: "fontTable", xml: `<w:fonts xmlns:w="${w}" xmlns:r="${r}"><w:font w:name="Original coast"><w:embedRegular r:id="font" w:fontKey="{38E185E1-4A31-4AB8-A420-FA578658AA11}" w:subsetted="1"/></w:font><!--retain--><?audit exact?></w:fonts>` } }, strict, { kind });
  const archive = await api.readArchive(input, textContext), parts = readPackage(input);
  const tableRels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="font" Type="${relationship}/font" Target="../assets/coast.bin"/></Relationships>`;
  const files = new Map(parts);
  files.set("word/_rels/fontTable.xml.rels", encode(tableRels));
  files.set("assets/coast.bin", new Uint8Array([0, 1, 2, 255, 42, 17]));
  files.set("assets/orphan.bin", new Uint8Array([99, 21, 0, 254]));
  const types = new api.DocumentXmlEditor(files.get("[Content_Types].xml")!);
  types.insertChildren(types.root, ["coast", "orphan"].map(name => `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/assets/${name}.bin" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont${parameter}"/>`).join(""));
  files.set("[Content_Types].xml", types.serialize());
  expect(new TextDecoder().decode(files.get("word/fontTable.xml"))).toContain(namespace);
  for (const [name, bytes] of files) if (name.endsWith(".xml") || name.endsWith(".rels")) {
    const encoded = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le");
    if (codec === "utf16be") encoded.swap16();
    files.set(name, new Uint8Array(encoded));
  }
  const memory = Volume.fromJSON({ "/input": "" });
  await api.writeArchive({ ...archive, members: [...files].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-03-04T05:06:08Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(memory.readFileSync("/input") as Buffer);
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const parameter of ["", ";original=retained"]) for (const selection of ["package", "paragraph"] as const)
for (const route of ["sdk", "cli", "batch"] as const)
  it(`native ${route} inventories inert declared fonts and retains bytes; ${selection}; MIME=${parameter}; ${kind}; strict=${strict}; codec=${codec}`, async () => {
    const input = await fixture(strict, kind, parameter), memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
    const options = selection === "paragraph" ? { paragraph: 1 } : {};
    let items: compiledTypes.FontInventoryData["items"];
    if (route === "sdk") items = (await api.inspectDocumentFonts(input, options, textContext)).items;
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const operations = { version: 1, operations: [{ operation: "fonts.list", arguments: options }] };
        await fs.writeFile("/operations", encode(JSON.stringify(operations)));
        const command = route === "cli" ? `docx fonts list /input ${selection === "paragraph" ? "--paragraph 1" : ""} --json` : "docx batch /input --ops-file /operations --json";
        const result = await shell.exec(command); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        const envelope = JSON.parse(result.stdout); expect(envelope.affected).toBe(0);
        const validate = route === "cli" ? validateFontResult : validateFontBatchResult;
        expect(validate(route === "cli" ? envelope : envelope.data.results[0]), JSON.stringify(validate.errors)).toBe(true);
        items = route === "cli" ? envelope.data.items : envelope.data.results[0].data.items;
        if (route === "batch") expect(envelope.data.publication).toBeNull();
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
    expect(items.map(item => item.name)).toEqual(selection === "package" ? ["/assets/coast.bin", "/assets/orphan.bin", "/word/fontTable.xml"] : ["/assets/coast.bin", "/word/fontTable.xml"]);
    const before = readPackage(input);
    for (const item of items) {
      expect(item).toMatchObject({ kind: "fonts", properties: [], support: item.name === "/word/fontTable.xml" ? "read" : "preserve", location: { kind: "part", value: { path: [], range: null, generation: 0 } }, details: { kind: "fonts" } });
      for (const part of item.details.parts) {
        const bytes = before.get(part.name.slice(1))!;
        expect(part.bytes).toBe(bytes.length);
        expect(part.sha256).toBe([...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))].map(value => value.toString(16).padStart(2, "0")).join(""));
      }
    }
    expect(items.find(item => item.name === "/assets/coast.bin")!.references).toContainEqual({ owner: "/word/fontTable.xml", id: "font", type: `${strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r}/font`, target: "../assets/coast.bin", external: false });
    expect(items.find(item => item.name === "/word/fontTable.xml")!.details.parts.map(part => part.name)).toEqual(["/assets/coast.bin", "/word/fontTable.xml"]);
    const inspected = await api.inspectDocument(input, textContext);
    expect(inspected.fontResources.fontTables[0]!.fonts[0]!.embedded[0]).toMatchObject({ target: "/assets/coast.bin", status: "resolved" });
    expect(inspected.fontResources).toMatchObject({ availability: null, licensing: null, embeddedFontMutation: "unsupported" });
    await api.replaceDocumentText(input, { find: "Retained", with: "Changed", first: true, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
    for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
    await expect(api.inspectDocumentFonts(output, { select: items[0]!.location.token }, textContext)).rejects.toMatchObject({ code: "stale-selection" });
    expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  });

}
