import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Ajv } from "ajv";
import type { DocxSchemaData } from "./index.js";
import addFormatsImport from "ajv-formats";
const addFormats = addFormatsImport as unknown as (validator: Ajv) => void;
import { applyStyleModelBatch, createDocxInspectionCommandEngine, getDocxDiscovery, docxOperationSchemas } from "./index.js";
import { textFixture, paragraph, textContext } from "../tests/fixtures/text.js";

const ref = (resultHandle: string) => ({ resultHandle });
const bootstrap = [
  { operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" },
  { operation: "model.styles.styles.Styles.part.get", receiver: ref("styles"), arguments: {}, resultHandle: "part" },
  { operation: "model.opc.part.XmlPart.package.get", receiver: ref("part"), arguments: {}, resultHandle: "package" }
];

it("exposes the package/part/relationship surface and correct typed results through the public CLI", async () => {
  const operations = [...bootstrap,
    { operation: "model.parts.styles.StylesPart.styles.get", receiver: ref("part"), arguments: {} },
    { operation: "model.parts.styles.StylesPart.default.call", arguments: { ownerPackage: ref("package") } },
    { operation: "model.package.Package.parts.get", receiver: ref("package"), arguments: {} },
    { operation: "model.package.Package.iter_parts.call", receiver: ref("package"), arguments: {} },
    { operation: "model.package.Package.iter_rels.call", receiver: ref("package"), arguments: {} },
    { operation: "model.package.Package.main_document_part.get", receiver: ref("package"), arguments: {}, resultHandle: "main" },
    { operation: "model.opc.part.Part.content_type.get", receiver: ref("main"), arguments: {} },
    { operation: "model.opc.part.Part.blob.get", receiver: ref("main"), arguments: {} },
    { operation: "model.opc.part.Part.partname.get", receiver: ref("main"), arguments: {} },
    { operation: "model.opc.part.Part.rels.get", receiver: ref("main"), arguments: {}, resultHandle: "rels" },
    { operation: "model.opc.rel.Relationships.xml.get", receiver: ref("rels"), arguments: {} },
    { operation: "model.opc.rel.Relationships.keys.call", receiver: ref("rels"), arguments: {} },
    { operation: "model.opc.rel.Relationships.values.call", receiver: ref("rels"), arguments: {} },
    { operation: "model.opc.rel.Relationships.items.call", receiver: ref("rels"), arguments: {} },
    { operation: "model.opc.rel.Relationships.copy.call", receiver: ref("rels"), arguments: {} },
    { operation: "model.opc.rel.Relationships.related_parts.get", receiver: ref("rels"), arguments: {} },
    { operation: "model.package.Package.core_properties.get", receiver: ref("package"), arguments: {}, resultHandle: "properties" },
    { operation: "model.opc.coreprops.CoreProperties.title.set", receiver: ref("properties"), arguments: { value: "Tidal survey" } },
    { operation: "model.opc.coreprops.CoreProperties.title.get", receiver: ref("properties"), arguments: {} },
    { operation: "model.opc.coreprops.CoreProperties.created.set", receiver: ref("properties"), arguments: { value: "2024-02-29T12:34:56.999Z" } },
    { operation: "model.opc.coreprops.CoreProperties.created.get", receiver: ref("properties"), arguments: {} }
  ];
  const input = await textFixture(paragraph("Coast"));
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/stdout": "", "/stderr": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "/input", "--ops-json", JSON.stringify({ version: 1, operations }), "--dry-run", "--json"].map(arg => new TextEncoder().encode(arg)),
    cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { volume.appendFileSync("/stdout", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/stderr", bytes); } }
  });
  expect(result.exitCode, volume.readFileSync("/stdout", "utf8") as string).toBe(0);
  const envelope = JSON.parse(volume.readFileSync("/stdout", "utf8") as string);
  const ajv = new Ajv({ strict: false }); addFormats(ajv);
  for (const item of envelope.data.results) {
    const schema = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: item.operation } })!;
    const declaration = (schema.data as DocxSchemaData).operations[0]!;
    const validate = ajv.compile(declaration.result);
    expect(validate(item), `${item.operation}: ${JSON.stringify(validate.errors)}`).toBe(true);
  }
  expect(envelope.data.results.at(-1).value).toBe("2024-02-29T12:34:56.000Z");
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});

it("resolves nested relationship handle entries without arbitrary property dispatch", async () => {
  const input = await textFixture(paragraph("Coast"));
  const result = await applyStyleModelBatch(input, { version: 1, operations: [...bootstrap,
    { operation: "model.opc.part.Part.rels.get", receiver: ref("part"), arguments: {}, resultHandle: "rels" },
    { operation: "model.opc.rel.Relationships.add_relationship.call", receiver: ref("rels"), arguments: { reltype: "urn:notes", target: "urn:inert", rId: "rId8", isExternal: true }, resultHandle: "edge" },
    { operation: "model.opc.rel.Relationships.update.call", receiver: ref("rels"), arguments: { entries: [["rId8", ref("edge")]] } },
    { operation: "model.opc.rel._Relationship.target_ref.get", receiver: ref("edge"), arguments: {} }
  ] }, textContext);
  expect(result.results.at(-1)!.value).toBe("urn:inert");
});

it("executes image collection and owned part factories through the shared typed batch contract", async () => {
  const { rasterPng } = await import("../tests/fixtures/raster.js");
  const input = await textFixture(paragraph("Coast"));
  const bytes = { kind: "bytes", base64: btoa(String.fromCharCode(...rasterPng(2, 3))) };
  const batch = { version: 1, operations: [...bootstrap,
    { operation: "model.package.Package.image_parts.get", receiver: ref("package"), arguments: {}, resultHandle: "images" },
    { operation: "model.package.Package.get_or_add_image_part.call", receiver: ref("package"), arguments: { imageDescriptor: bytes }, resultHandle: "imagePart" },
    { operation: "model.package.ImageParts.__contains__.call", receiver: ref("images"), arguments: { value: ref("imagePart") } },
    { operation: "model.package.ImageParts.__iter__.call", receiver: ref("images"), arguments: {} },
    { operation: "model.package.ImageParts.__len__.get", receiver: ref("images"), arguments: {} },
    { operation: "model.package.ImageParts.append.call", receiver: ref("images"), arguments: { item: ref("imagePart") } },
    { operation: "model.package.ImageParts.get_or_add_image_part.call", receiver: ref("images"), arguments: { imageDescriptor: bytes } },
    ...["default_cx", "default_cy", "filename", "image", "sha1", "blob", "content_type", "partname", "package", "rels", "related_parts"].map(name => ({ operation: `model.parts.image.ImagePart.${name}.get`, receiver: ref("imagePart"), arguments: {} })),
    { operation: "model.opc.part.Part.load.call", arguments: { partname: "/data/notes.bin", contentType: "application/octet-stream", blob: { kind: "bytes", base64: "AQID" }, ownerPackage: ref("package") }, resultHandle: "loaded" },
    { operation: "model.opc.part.XmlPart.load.call", arguments: { partname: "/data/tree.xml", contentType: "application/xml", blob: { kind: "bytes", base64: btoa("<tree/>") }, ownerPackage: ref("package") } },
    { operation: "model.opc.parts.coreprops.CorePropertiesPart.default.call", arguments: { ownerPackage: ref("package") }, resultHandle: "core" },
    { operation: "model.opc.parts.coreprops.CorePropertiesPart.core_properties.get", receiver: ref("core"), arguments: {} }
  ] };
  const result = await applyStyleModelBatch(input, batch, textContext);
  const ajv = new Ajv({ strict: false }); addFormats(ajv);
  for (const item of result.results) {
    const schema = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: item.operation } })!;
    const declaration = (schema.data as DocxSchemaData).operations[0]!;
    const validate = ajv.compile(declaration.result);
    expect(validate(item), `${item.operation}: ${JSON.stringify(validate.errors)}`).toBe(true);
  }
  expect(result.results[5]!.value).toBe(true);
  expect(result.affected).toBe(5);
});

it("reports XML/package schema feature ownership instead of style-only support", () => {
  expect(docxOperationSchemas["model.package.Package.main_document_part.get"]!.valueType).toBe("XmlPartView");
  expect(docxOperationSchemas["model.opc.package.OpcPackage.main_document_part.get"]!.resultHandle?.type).toBe("XmlPartView");
  for (const [operation, feature] of [["model.XmlElementView.text.set", "F07"], ["model.opc.rel._Relationship.target_ref.get", "F01"], ["model.package.Package.core_properties.get", "F31"]]) {
    const schema = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation } })!;
    expect((schema.data as DocxSchemaData).operations[0]!.featureIds).toContain(feature);
  }
});

it("preserves required-key pop semantics in typed batches", async () => {
  const input = await textFixture(paragraph("Coast"));
  await expect(applyStyleModelBatch(input, { version: 1, operations: [...bootstrap,
    { operation: "model.opc.part.Part.rels.get", receiver: ref("part"), arguments: {}, resultHandle: "rels" },
    { operation: "model.opc.rel.Relationships.pop.call", receiver: ref("rels"), arguments: { rId: "missing" } }
  ] }, textContext)).rejects.toThrow();
});
