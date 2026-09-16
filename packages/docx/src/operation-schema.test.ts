import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { assertDocxFields, docxOperationSchemas, validateDocxValue } from "./operation-schema.js";

describe("closed operation schema", () => {
  it("declares common operations and preserves model member spellings", () => {
    expect(docxOperationSchemas["text.replace"]!.fields.find).toEqual({ type: "string", required: true });
    expect(docxOperationSchemas["text.replace"]!.sdkFields.with).toEqual({ type: "string", required: true });
    expect(docxOperationSchemas["model.table._Cell.text.set"]!.receiver).toBe("_Cell");
    expect(docxOperationSchemas["model.text.run.Run.bold.set"]!.fields.value!.type).toBe("boolean | null");
    expect(docxOperationSchemas["image.list"]).toBeUndefined();
  });
  it("rejects unknown and absent required fields while preserving false, empty and null values", () => {
    const fields = docxOperationSchemas["text.replace"]!.fields;
    expect(() => assertDocxFields(fields, { find: "draft", with: "" })).not.toThrow();
    expect(() => assertDocxFields(fields, { find: "draft", with: null })).toThrow();
    expect(() => assertDocxFields(fields, { find: "draft", with: undefined })).toThrow();
    expect(() => assertDocxFields(fields, { find: "draft", with: "", typo: true })).toThrow();
    expect(() => assertDocxFields(docxOperationSchemas["model.text.run.Run.bold.set"]!.fields, { value: null })).not.toThrow();
  });
  it("validates enum identities, numbers, dates and explicit units", () => {
    expect(validateDocxValue("WD_PARAGRAPH_ALIGNMENT", { enum: "WD_PARAGRAPH_ALIGNMENT", name: "CENTER" })).toBe(true);
    expect(validateDocxValue("WD_PARAGRAPH_ALIGNMENT", { enum: "WD_PARAGRAPH_ALIGNMENT", name: "invented" })).toBe(false);
    expect(validateDocxValue("WD_PARAGRAPH_ALIGNMENT", 1)).toBe(false);
    expect(validateDocxValue("Length", { value: 2.5, unit: "cm" })).toBe(true);
    expect(validateDocxValue("Length", { value: Infinity, unit: "cm" })).toBe(false);
    expect(validateDocxValue("positive integer", true)).toBe(false);
    expect(validateDocxValue("integer", Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(validateDocxValue("UTC date", "2024-02-29")).toBe(true);
    expect(validateDocxValue("UTC date", "2023-02-29")).toBe(false);
  });
  it("admits finite numeric scalars independently of integer identity precision", () => {
    for (const value of [1e16, -1e16, Number.MAX_SAFE_INTEGER + 1, Number.MAX_VALUE]) {
      for (const type of ["number", "finite number", "typed scalar"]) expect(validateDocxValue(type, value)).toBe(true);
      expect(() => assertDocxFields({ value: { type: "number", required: true } }, { value })).not.toThrow();
      expect(validateDocxValue("ReadonlyArray<number>", [value])).toBe(true);
      for (const type of ["integer", "safe integer", "positive integer", "nonnegative safe integer"]) expect(validateDocxValue(type, value)).toBe(false);
    }
    for (const value of [NaN, Infinity, -Infinity]) {
      for (const type of ["number", "finite number", "typed scalar"]) expect(validateDocxValue(type, value)).toBe(false);
      expect(validateDocxValue("ReadonlyArray<number>", [value])).toBe(false);
    }
    expect(validateDocxValue("Length", { value: 1e16, unit: "invented" })).toBe(false);
    expect(validateDocxValue("fraction 0..1", 1e16)).toBe(false);
    expect(validateDocxValue("finite degrees", 1e16)).toBe(false);
  });
  it("admits finite numeric values in declared binding records", () => {
    for (const value of [1e16, -1e16, Number.MAX_VALUE]) expect(validateDocxValue("DeclaredControlRecord", { values: [{ binding: "measurement", value }] })).toBe(true);
    for (const value of [NaN, Infinity, -Infinity]) expect(validateDocxValue("DeclaredControlRecord", { values: [{ binding: "measurement", value }] })).toBe(false);
  });
  it("validates closed content and nested binary inputs", () => {
    expect(validateDocxValue("OriginalDocumentContentV1", { version: 1, blocks: [{ kind: "paragraph", text: "Café 文書" }] })).toBe(true);
    expect(validateDocxValue("OriginalDocumentContentV1", { version: 1, blocks: [{ kind: "paragraph", text: "", runs: [] }] })).toBe(false);
    expect(validateDocxValue("BinaryInput", { kind: "bytes", base64: "AAEC/w==" })).toBe(true);
    expect(validateDocxValue("BinaryInput", { kind: "bytes", base64: "%%%" })).toBe(false);
    expect(validateDocxValue("BinaryInput", { kind: "vfs", path: "文書.docx", capability: "files", extra: true })).toBe(false);
    expect(validateDocxValue("DeclaredControlRecord", { values: [{ binding: "title", value: "A" }, { binding: "title", value: "B" }] })).toBe(false);
  });
  it("rejects hostile object graphs and unknown domain type names", () => {
    const cycle: { version: number; blocks: unknown[] } = { version: 1, blocks: [] };
    cycle.blocks.push(cycle);
    expect(validateDocxValue("OriginalDocumentContentV1", cycle)).toBe(false);
    expect(validateDocxValue("string", "\ud800")).toBe(false);
    expect(validateDocxValue("invented", {})).toBe(false);
  });
  it("rejects sparse arrays and invokes no accessors during validation", () => {
    const sparse = new Array(1);
    expect(validateDocxValue("ReadonlyArray<DeclaredControlRecord>", sparse)).toBe(false);
    let invoked = false;
    const unsafe = Object.defineProperty({}, "version", { enumerable: true, get() { invoked = true; return 1; } });
    expect(validateDocxValue("OriginalDocumentContentV1", unsafe)).toBe(false);
    expect(invoked).toBe(false);
  });
  it("accepts the declared sanitization list and rejects empty or duplicate entries", () => {
    const type = "nonempty unique list: properties|comments|revisions|links|objects";
    expect(validateDocxValue(type, ["properties", "comments"])).toBe(true);
    expect(validateDocxValue(type, [])).toBe(false);
    expect(validateDocxValue(type, ["comments", "comments"])).toBe(false);
  });
  it("validates value enum aliases and closed model handles", () => {
    expect(validateDocxValue("MSO_THEME_COLOR", { enum: "MSO_THEME_COLOR", name: "ACCENT_1" })).toBe(true);
    expect(validateDocxValue("_Cell", { id: "cell-1", type: "_Cell", owner: "document-1", revision: 0 })).toBe(true);
    expect(validateDocxValue("_Cell", { id: "cell-1", type: "Run", owner: "document-1", revision: 0 })).toBe(false);
    expect(validateDocxValue("Run", { resultHandle: "heading", index: 0, key: "title" })).toBe(false);
  });

  it("validates common selector and limit values without acquiring authority", () => {
    expect(validateDocxValue("logical cell coordinate", "AZ12")).toBe(true);
    expect(validateDocxValue("logical cell coordinate", "A0")).toBe(false);
    expect(validateDocxValue("logical cell coordinate", "a2")).toBe(false);
    expect(validateDocxValue("ReadonlyArray<{name: LimitName; value: nonnegative safe integer}>", [{ name: "xmlNodes", value: 10 }])).toBe(true);
    expect(validateDocxValue("ReadonlyArray<{name: LimitName; value: nonnegative safe integer}>", [{ name: "hostFiles", value: 10 }])).toBe(false);
    expect(validateDocxValue("DocumentContext", {})).toBe(true);
    expect(validateDocxValue("DocumentContext", { vfs: "files", author: "", limits: { xmlDepth: 20 } })).toBe(true);
    expect(validateDocxValue("DocumentContext", { vfs: "files", network: true })).toBe(false);
  });
  it("admits declarative XML nodes and never code or entity declarations", () => {
    expect(validateDocxValue("XmlNodeInput", { kind: "text", text: "Résumé" })).toBe(true);
    expect(validateDocxValue("XmlNodeInput", { kind: "element", name: { namespaceURI: "urn:sample", localName: "title" }, children: [{ kind: "text", text: "Report" }] })).toBe(true);
    expect(validateDocxValue("XmlNodeInput", { kind: "entity", name: "secret" })).toBe(false);
    expect(validateDocxValue("XmlNodeInput", { kind: "text", text: "", run: () => "x" })).toBe(false);
    expect(validateDocxValue("Iterable<readonly [string, RelationshipView]>", [["rId2", { resultHandle: "relation" }]])).toBe(true);
  });

  it("resolves enum method type parameters to their declared receiver enum", () => {
    const fields = docxOperationSchemas["model.enum.text.WD_PARAGRAPH_ALIGNMENT.to_xml.call"]!.fields;
    expect(() => assertDocxFields(fields, { value: { enum: "WD_PARAGRAPH_ALIGNMENT", name: "CENTER" } })).not.toThrow();
    expect(() => assertDocxFields(fields, { value: { enum: "WD_BREAK", name: "PAGE" } })).toThrow();
  });

  it("publishes immutable closed schema declarations", () => {
    expect(Object.isFrozen(docxOperationSchemas)).toBe(true);
    expect(Object.isFrozen(docxOperationSchemas["text.replace"]!.fields)).toBe(true);
    expect(docxOperationSchemas["constructor"]).toBeUndefined();
  });

  it("distinguishes model mutation effects from reads and value helpers", () => {
    expect(docxOperationSchemas["model.XmlElementView.remove.call"]!.mutates).toBe(true);
    expect(docxOperationSchemas["model.opc.rel.Relationships.__setitem__.call"]!.mutates).toBe(true);
    expect(docxOperationSchemas["model.opc.coreprops.CoreProperties.comments.get"]!.mutates).toBe(false);
    expect(docxOperationSchemas["model.document.Document.comments.get"]!.mutates).toBe(true);
    expect(docxOperationSchemas["model.shared.Inches.call"]!.mutates).toBe(false);
  });
  it("uses explicit serialized forms for model byte and date arguments", () => {
    expect(validateDocxValue("Uint8Array", { kind: "bytes", base64: "AA==" })).toBe(true);
    expect(validateDocxValue("Date", "2024-02-29T00:00:00Z")).toBe(true);
    expect(validateDocxValue("Input", { path: "文書.docx", capability: "files" })).toBe(true);
  });

  it("rejects exotic arrays and overridden built-in value hooks without calling them", () => {
    let invoked = false;
    class CustomArray extends Array<unknown> {}
    Object.defineProperty(CustomArray.prototype, "every", { value: () => { invoked = true; return true; } });
    expect(validateDocxValue("ReadonlyArray<DeclaredControlRecord>", new CustomArray())).toBe(false);
    const timestamp = new Date("2024-01-01T00:00:00Z");
    timestamp.getTime = () => { invoked = true; return 0; };
    expect(validateDocxValue("Date", timestamp)).toBe(false);
    class CustomBytes extends Uint8Array {}
    expect(validateDocxValue("Uint8Array", new CustomBytes())).toBe(true);
    expect(invoked).toBe(false);
  });

  it("accepts every declared scope and rejects undeclared scope tokens", () => {
    const type = "body|headers|footers|footnotes|endnotes|comments|text-boxes|all-stories";
    for (const scope of ["body", "headers", "footers", "footnotes", "endnotes", "comments", "text-boxes", "all-stories"]) expect(validateDocxValue(type, scope)).toBe(true);
    expect(validateDocxValue(type, "document")).toBe(false);
  });

  it("admits Buffer and byte views without consulting custom hooks", () => {
    const bytes = Buffer.from([0, 255, 128]);
    Object.defineProperty(bytes, "byteLength", { get() { throw new Error("must not read custom byte hook"); } });
    expect(validateDocxValue("Uint8Array", bytes)).toBe(true);
  });

});
