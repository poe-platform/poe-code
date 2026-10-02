import { Volume } from "memfs";
import { expect, it } from "vitest";
import { SaxesParser } from "saxes";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const cp = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const terms = "http://purl.org/dc/terms/", xsi = "http://www.w3.org/2001/XMLSchema-instance";
const ref = (resultHandle: string) => ({ resultHandle });
function encode(text: string, codec: string): Uint8Array {
  if (codec === "utf8") return new TextEncoder().encode(text);
  const bytes = Buffer.from(`<?xml version="1.0" encoding="UTF-16"?>${text}`, "utf16le");
  if (codec === "utf16be") bytes.swap16();
  return new Uint8Array(Buffer.concat([Buffer.from(codec === "utf16be" ? [254, 255] : [255, 254]), bytes]));
}
function decode(bytes: Uint8Array): string {
  return new TextDecoder(bytes[0] === 254 ? "utf-16be" : bytes[0] === 255 ? "utf-16le" : "utf8").decode(bytes);
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const key of ["created", "modified"] as const) for (const present of [false, true])
for (const codec of ["utf8", "utf16le", "utf16be"])
for (const route of ["model", "model-sdk", "model-cli", "sdk", "cli", "cli-batch"] as const)
it(`core date datatype QName remains bound with occupied prefixes; strict=${strict}; kind=${kind}; key=${key}; present=${present}; codec=${codec}; route=${route}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retained海🌊</w:t></w:r></w:p>', {}, strict, { kind }));
  const name = "metadata/typed.xml", unrelated = '<dcterms:opaque dcterms:flag="keep">Retained海🌊</dcterms:opaque>';
  const source = `<p:coreProperties xmlns:p="${cp}" xmlns:t="${terms}" xmlns:i="${xsi}" xmlns:dcterms="urn:original:occupied">${present ? `<t:${key} i:type="t:W3CDTF">2001-02-03T04:05:06Z</t:${key}>` : ""}<!--retain-->${unrelated}<?audit exact?></p:coreProperties>`;
  parts.set(name, encode(source, codec));
  const types = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!);
  types.insertChildren(types.root, `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/${name}" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`);
  parts.set("[Content_Types].xml", types.serialize());
  const edges = new api.DocumentXmlEditor(parts.get("_rels/.rels")!);
  edges.insertChildren(edges.root, `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="Typed" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="${name}"/>`);
  parts.set("_rels/.rels", edges.serialize());
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) },
    { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), value = "1969-12-31T23:59:59.900Z";
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const modelOperations = [
    { operation: "model.document.Document.core_properties.get", receiver: ref("document"), arguments: {}, resultHandle: "core" },
    { operation: `model.opc.coreprops.CoreProperties.${key}.set`, receiver: ref("core"), arguments: { value } },
    { operation: `model.opc.coreprops.CoreProperties.${key}.get`, receiver: ref("core"), arguments: {} }
  ];
  const operations = route.startsWith("model") ? modelOperations : [{ operation: "properties.set", arguments: { name: `core:${key}`, value } }];
  if (route === "model") {
    const doc = await api.Document(input, context);
    expect(doc.core_properties[key]?.toISOString() ?? null).toBe(present ? "2001-02-03T04:05:06.000Z" : null);
    doc.core_properties[key] = new Date(value);
    expect(doc.core_properties[key]?.toISOString()).toBe("1969-12-31T23:59:59.000Z");
    await doc.save(sink);
  } else if (route === "model-sdk") {
    const result = await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: sink });
    expect(result.results.at(-1)!.data).toBe("1969-12-31T23:59:59.000Z");
  } else if (route === "sdk") await api.editDocumentProperties(input, { operation: "properties.set", name: `core:${key}`, value, output: "-" }, { ...context, stdout: sink });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retained destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const command = route === "cli" ? `docx properties set /input --name core:${key} --value ${value}` : `docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}'`;
      const result = await shell.exec(command + " --output /destination --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      if (route === "model-cli") expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe("1969-12-31T23:59:59.000Z");
      memory.writeFileSync("/output", await fs.readFile("/destination")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output), bytes = after.get(name)!;
  expect([...after.keys()]).toEqual([...parts.keys()]);
  for (const [part, original] of parts) if (part !== name) expect(after.get(part), part).toEqual(original);
  if (codec !== "utf8") expect(bytes.slice(0, 2)).toEqual(parts.get(name)!.slice(0, 2));
  const text = decode(bytes); expect(text).toContain(unrelated); expect(text).toContain("<!--retain-->"); expect(text).toContain("<?audit exact?>");
  const parser = new SaxesParser({ xmlns: true }), values: string[] = [], scopes: Record<string, string>[] = [];
  parser.on("opentag", tag => {
    scopes.push({ ...scopes.at(-1), ...tag.ns });
    if (tag.uri !== terms || tag.local !== key) return;
    const type = Object.values(tag.attributes).find(attribute => attribute.uri === xsi && attribute.local === "type")?.value;
    expect(type).toBeDefined();
    const [prefix, local] = type!.split(":");
    expect(local).toBe("W3CDTF"); expect(scopes.at(-1)![prefix!]).toBe(terms); values.push(type!);
  });
  parser.on("closetag", () => { scopes.pop(); });
  parser.write(text).close(); expect(values).toHaveLength(1);
  if (present) expect(values).toEqual(["t:W3CDTF"]);
  const reopened = await api.Document(output, context);
  expect(reopened.core_properties[key]?.toISOString()).toBe("1969-12-31T23:59:59.000Z");
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
