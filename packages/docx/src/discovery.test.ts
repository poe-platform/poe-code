import { describe, expect, it } from "vitest";
import metadata from "../package.json" with { type: "json" };
import { getDocxDiscovery } from "./discovery.js";
import { parseDocxArguments } from "./command.js";
import { DocumentBudget } from "./budget.js";
import { CancellationError, ResourceLimitError } from "./archive.js";
import { docxCommonOptions, docxOperationSchemas } from "./operation-schema.js";
import { getDocxOperationSchema } from "./operation-json-schema.js";

const discover = (...words: string[]) => getDocxDiscovery(parseDocxArguments(words.map(word => new TextEncoder().encode(word))));

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
      { path: ["inspect"] }, { path: ["validate"] }, { path: ["help"] }, { path: ["schema"] }, { path: ["capabilities"] }, { path: ["version"] }
    ] });
    expect(root.human).toContain("Implemented commands");
    expect(root.human).not.toContain("docx create");
    const detail = discover("text", "replace", "--help")!;
    expect(detail.human).toContain("not implemented");
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
      result: { properties: { ok: { const: false }, data: { type: "null" } } }, support: "reject"
    }] });
    const root = discover("schema")!.data as { operations: readonly { id: string; result: unknown }[] };
    expect(root.operations.map(item => item.id)).toEqual(["inspect", "validate", "help", "schema", "capabilities", "version"]);
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
    expect(result.data).toMatchObject({ features: [{ id: "F06", level: "read" }, { id: "F49", level: "read" }], host: { read: false, atomicReplace: false, transactions: false, binaryStdout: true } });
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
