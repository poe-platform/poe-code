import { describe, expect, it } from "vitest";
import metadata from "../package.json" with { type: "json" };
import { getDocxDiscovery } from "./discovery.js";
import { parseDocxArguments } from "./command.js";
import { DocumentBudget } from "./budget.js";
import { CancellationError, ResourceLimitError } from "./archive.js";
import { docxCommonOptions, docxOperationSchemas } from "./operation-schema.js";
import { getDocxOperationSchema } from "./operation-json-schema.js";
import { validateDocxBatch } from "./command.js";

const discover = (...words: string[]) => getDocxDiscovery(parseDocxArguments(words.map(word => new TextEncoder().encode(word))));
it("publishes factory wire fields that admit only byte blobs and finite image contexts", () => {
  const prefix = "model.image.image.Image";
  const schema = getDocxOperationSchema(`${prefix}.from_blob.call`, "batch");
  expect(schema.properties?.blob).toMatchObject({ type: "object", properties: { kind: { const: "bytes" } } });
  for (const name of ["from_blob", "from_file"]) {
    const context = getDocxOperationSchema(`${prefix}.${name}.call`, "batch").properties?.context;
    expect(Object.keys(context?.properties ?? {})).toEqual(["vfs", "limits"]);
    expect(context?.additionalProperties).toBe(false);
  }
  expect(() => validateDocxBatch({ version: 1, operations: [{ operation: `${prefix}.from_blob.call`, arguments: { blob: { kind: "vfs", path: "/Map.PNG", capability: "command" } } }] })).toThrow();
  expect(() => validateDocxBatch({ version: 1, operations: [{ operation: `${prefix}.from_blob.call`, arguments: { blob: { kind: "bytes", base64: "AA==" }, context: { author: "Harbor" } } }] })).toThrow();
});
it("enforces canonical base64 pad bits in published image blob schemas", () => {
  const encoded = getDocxOperationSchema("model.image.image.Image.from_blob.call", "batch").properties?.blob?.properties?.base64;
  expect(encoded?.pattern).toBeTypeOf("string");
  const pattern = new RegExp(encoded!.pattern!);
  for (const value of ["", "AA==", "AQ==", "AAA=", "AAE=", "AAAA"]) expect(pattern.test(value)).toBe(true);
  for (const value of ["AB==", "AAF=", "AA=", "AAAA=", "A A=", "AA\n=="]) expect(pattern.test(value)).toBe(false);
});
it("advertises standalone immutable Image routes independently of document style handles", () => {
  const ids = Object.keys(docxOperationSchemas).filter(id => id.startsWith("model.image.image.Image."));
  expect(ids).toHaveLength(14);
  for (const id of ids) {
    expect(discover("schema", "--operation", id)!.data).toMatchObject({ operations: [{ id, support: "read", featureIds: ["F32"] }] });
    expect(JSON.stringify(discover("help", "--operation", id))).toContain("immutable Image");
  }
  expect(discover("capabilities")!.data).toMatchObject({ features: expect.arrayContaining([expect.objectContaining({ id: "F32", level: "edit", subsets: expect.arrayContaining([
    expect.objectContaining({ name: "inline-png-jpeg-insertion", level: "edit" }), expect.objectContaining({ name: "standalone-image-values", level: "read" })
  ]) })]) });
});
it("includes native repeat inventories in the sole controls list feature profile", () => {
  expect(discover("schema", "--operation", "controls.list")!.data).toMatchObject({ operations: [{ featureIds: ["F28", "F29"] }] });
});
it("advertises only bounded native control repetition and complete binding synchronization", () => {
  for (const operation of ["controls.repeat", "controls.bind"]) {
    const schema = discover("schema", "--operation", operation)!.data;
    expect(schema).toMatchObject({ operations: [{ id: operation, support: "edit", featureIds: ["F29"], result: { oneOf: [{ properties: { affected: { type: "integer" } } }, {}] } }] });
  }
  expect(discover("capabilities")!.data).toMatchObject({ features: expect.arrayContaining([{ id: "F29", level: "edit", subsets: expect.arrayContaining([expect.objectContaining({ name: "native-repetition", level: "edit" }), expect.objectContaining({ name: "binding-synchronization", level: "edit" })]), detected: null }]) });
  expect(Object.keys(docxOperationSchemas)).not.toContain("model.controls.repeat");
});

describe("document discovery", () => {
  it("applies output ceilings to SDK discovery before returning data", () => {
    expect(() => getDocxDiscovery({ operation: "schema", inputs: [], options: {} }, new DocumentBudget({ serializedOutput: 1 }))).toThrow(ResourceLimitError);
    expect(() => discover("capabilities", "--limit", "serializedOutput=1")).toThrow(ResourceLimitError);
  });
  it("retains cancellation when parsed help is passed to SDK discovery", () => {
    const controller = new AbortController();
    const invocation = parseDocxArguments(["text", "replace", "--help"].map(word => new TextEncoder().encode(word)), new DocumentBudget({}, controller.signal));
    controller.abort();
    expect(() => getDocxDiscovery(invocation)).toThrow(CancellationError);
  });
  it("gets the utility version from its actual package metadata", () => {
    expect(discover("version")?.data).toEqual({ name: "docx", version: metadata.version, schemaVersion: 1 });
    expect(discover("--version")?.human).toBe(`docx ${metadata.version}\n`);
  });

  it("lists only implemented discovery paths and generates options from declarations", () => {
    const root = discover("help")!;
    expect(root.data).toMatchObject({ name: "docx", paths: [
      { path: ["create"] }, { path: ["inspect"] }, { path: ["validate"] }, { path: ["text", "get"] }, { path: ["text", "replace"] }, { path: ["xml", "get"] }, { path: ["xml", "set"] }, { path: ["paragraphs", "add"] }, { path: ["paragraphs", "set"] }, { path: ["runs", "add"] }, { path: ["runs", "set"] }, { path: ["styles", "list"] }, { path: ["sections", "list"] }, { path: ["headers", "list"] }, { path: ["footers", "list"] }, { path: ["links", "list"] }, { path: ["bookmarks", "list"] }, { path: ["fields", "list"] }, { path: ["notes", "list"] }, { path: ["comments", "list"] }, { path: ["controls", "list"] }, { path: ["images", "list"] }, { path: ["styles", "get"] }, { path: ["styles", "add"] }, { path: ["styles", "set"] }, { path: ["sections", "add"] }, { path: ["sections", "set"] }, { path: ["headers", "get"] }, { path: ["headers", "set"] }, { path: ["headers", "remove"] }, { path: ["footers", "get"] }, { path: ["footers", "set"] }, { path: ["footers", "remove"] }, { path: ["lists", "add"] }, { path: ["lists", "set"] }, { path: ["tables", "get"] }, { path: ["tables", "add"] }, { path: ["tables", "set"] }, { path: ["tables", "rows", "add"] }, { path: ["tables", "rows", "remove"] }, { path: ["tables", "columns", "add"] }, { path: ["tables", "columns", "remove"] }, { path: ["tables", "merge"] }, { path: ["tables", "split"] }, { path: ["links", "add"] }, { path: ["links", "set"] }, { path: ["links", "remove"] }, { path: ["bookmarks", "add"] }, { path: ["bookmarks", "set"] }, { path: ["bookmarks", "remove"] }, { path: ["fields", "add"] }, { path: ["fields", "set"] }, { path: ["toc", "add"] }, { path: ["captions", "add"] }, { path: ["toc", "set"] }, { path: ["captions", "set"] }, { path: ["notes", "get"] }, { path: ["notes", "add"] }, { path: ["notes", "set"] }, { path: ["notes", "remove"] }, { path: ["comments", "get"] }, { path: ["comments", "add"] }, { path: ["comments", "set"] }, { path: ["comments", "remove"] }, { path: ["revisions", "list"] }, { path: ["revisions", "add"] }, { path: ["revisions", "accept"] }, { path: ["revisions", "reject"] }, { path: ["controls", "set"] }, { path: ["controls", "repeat"] }, { path: ["controls", "bind"] }, { path: ["properties", "list"] }, { path: ["properties", "get"] }, { path: ["properties", "set"] }, { path: ["properties", "remove"] }, { path: ["images", "get"] }, { path: ["images", "add"] }, { path: ["images", "extract"] }, { path: ["custom-xml", "list"] }, { path: ["glossary", "list"] }, { path: ["batch"] }, { path: ["help"] }, { path: ["schema"] }, { path: ["capabilities"] }, { path: ["version"] }, { path: ["styles", "defaults", "get"] }, { path: ["styles", "defaults", "set"] }, { path: ["styles", "latent", "list"] }, { path: ["styles", "latent", "get"] }, { path: ["styles", "latent", "add"] }, { path: ["styles", "latent", "set"] }, { path: ["styles", "latent", "remove"] }, { path: ["styles", "latent", "defaults", "get"] }, { path: ["styles", "latent", "defaults", "set"] }
    ] });
    expect(root.human).toContain("Implemented commands");
    expect(root.human).toContain("docx create");
    const detail = discover("text", "replace", "--help")!;
    expect(detail.human).toContain("Replace literal paragraph text");
    const declaration = docxOperationSchemas["text.replace"]!;
    for (const field of [...declaration.commonOptions, ...Object.keys(declaration.fields)]) {
      const flag = [...field].map(c => c >= "A" && c <= "Z" ? "-" + c.toLowerCase() : c).join("");
      expect(detail.human).toContain(`--${flag}`);
      const type = declaration.fields[field]?.type ?? docxCommonOptions[field]!.type;
      expect(detail.human).toContain(type);
    }
    expect(detail.human).toContain("--first | --all | --occurrence");
    expect(detail.human).toContain("--output PATH | --in-place | --dry-run");
  });

  it("uses the same declared input schema and explicitly rejects planned result claims", () => {
    const schema = discover("schema", "text", "replace")!;
    expect(schema.data).toMatchObject({ schemaVersion: 1, operations: [{
      id: "text.replace", path: ["text", "replace"], input: getDocxOperationSchema("text.replace"),
      result: { oneOf: [{ properties: { ok: { const: true }, affected: { type: "integer", minimum: 0 } } }, { properties: { ok: { const: false }, data: { type: "null" } } }] }, support: "edit"
    }] });
    const root = discover("schema")!.data as { operations: readonly { id: string; result: unknown }[] };
    expect(root.operations.filter(item => !item.id.startsWith("model.")).map(item => item.id)).toEqual(["create", "inspect", "validate", "text.get", "text.replace", "xml.get", "xml.set", "paragraphs.add", "paragraphs.set", "runs.add", "runs.set", "styles.list", "sections.list", "headers.list", "footers.list", "links.list", "bookmarks.list", "fields.list", "notes.list", "comments.list", "controls.list", "images.list", "styles.get", "styles.add", "styles.set", "sections.add", "sections.set", "headers.get", "headers.set", "headers.remove", "footers.get", "footers.set", "footers.remove", "lists.add", "lists.set", "tables.get", "tables.add", "tables.set", "tables.rows.add", "tables.rows.remove", "tables.columns.add", "tables.columns.remove", "tables.merge", "tables.split", "links.add", "links.set", "links.remove", "bookmarks.add", "bookmarks.set", "bookmarks.remove", "fields.add", "fields.set", "toc.add", "captions.add", "toc.set", "captions.set", "notes.get", "notes.add", "notes.set", "notes.remove", "comments.get", "comments.add", "comments.set", "comments.remove", "revisions.list", "revisions.add", "revisions.accept", "revisions.reject", "controls.set", "controls.repeat", "controls.bind", "properties.list", "properties.get", "properties.set", "properties.remove", "images.get", "images.add", "images.extract", "custom-xml.list", "glossary.list", "batch", "help", "schema", "capabilities", "version", "styles.defaults.get", "styles.defaults.set", "styles.latent.list", "styles.latent.get", "styles.latent.add", "styles.latent.set", "styles.latent.remove", "styles.latent.defaults.get", "styles.latent.defaults.set"]);
    expect(discover("schema", "images", "replace")!.data).toMatchObject({ operations: [{ support: "reject", result: { properties: { ok: { const: false } } } }] });
    expect(root.operations.find(item => item.id === "version")!.result).toMatchObject({ oneOf: [
      { properties: { version: { const: 1 }, operation: { const: "version" }, data: { properties: { version: { type: "string" } } } } },
      { properties: { ok: { const: false }, data: { type: "null" }, errors: { minItems: 1 } } }
    ] });
  });

  it("includes private-looking public model declarations without claiming implementation", () => {
    const id = Object.keys(docxOperationSchemas).find(id => id.includes("._") && docxOperationSchemas[id]!.transport === "typed-batch")!;
    expect(id).toBeTruthy();
    const result = discover("help", "batch", "--operation", id)!;
    expect(result.human).toContain(id);
    expect(result.human).toContain("not implemented");
    expect(discover("schema", "batch", "--operation", id)!.data).toMatchObject({ operations: [{ id, path: ["batch"], support: "reject" }] });
  });

  it("reports conservative host support and effective limits without document claims", () => {
    const budget = new DocumentBudget({ compressedInput: 1234 });
    const result = getDocxDiscovery({ operation: "capabilities", inputs: [], options: {} }, budget)!;
    expect(result.data).toMatchObject({ features: [{ id: "F32", level: "edit" }, { id: "F31", level: "read" }, { id: "F33", level: "read" }, { id: "F34", level: "read" }, { id: "F35", level: "read" }, { id: "F30", level: "edit" }, { id: "F28", level: "edit" }, { id: "F29", level: "edit" }, { id: "F26", level: "edit" }, { id: "F27", level: "read" }, { id: "F25", level: "edit" }, { id: "F24", level: "edit" }, { id: "F23", level: "edit" }, { id: "F22", level: "edit" }, { id: "F21", level: "edit" }, { id: "F20", level: "edit" }, { id: "F19", level: "edit" }, { id: "F18", level: "edit" }, { id: "F17", level: "edit" }, { id: "F16", level: "edit" }, { id: "F41", level: "preserve" }, { id: "F42", level: "read" }, { id: "F15", level: "edit" }, { id: "F14", level: "edit" }, { id: "F13", level: "edit" }, { id: "F12", level: "edit" }, { id: "F11", level: "edit" }, { id: "F06", level: "read" }, { id: "F49", level: "read" }, { id: "F08", level: "read" }, { id: "F09", level: "read" }, { id: "F07", level: "edit" }, { id: "F10", level: "edit" }], host: { read: false, atomicReplace: false, transactions: false, binaryStdout: true } });
    expect((result.data as { limits: readonly unknown[] }).limits).toContainEqual({ name: "compressedInput", ceiling: 1234 });
    expect(result.human).toContain("Inspection and partial core-v1 validation are implemented");
    expect(discover("capabilities", "report.docx")).toBeUndefined();
    expect(discover("text", "report.docx")).toBeUndefined();
  });
});
it("advertises inspection and validation as read-only implemented operations", () => {
  for (const id of ["inspect", "validate"]) {
    expect(discover("schema", id)?.data).toMatchObject({ operations: [{ id, support: "read" }] });
    expect(discover("help", id)?.human).not.toContain("not implemented");
  }
});
