import { describe, expect, it } from "vitest";
import { projectJsonSchemaProperties } from "../index.js";

describe("JSON Schema object property projection", () => {
  it("projects named properties with their native validators and required status", () => {
    const properties = projectJsonSchemaProperties({ type: "object", properties: {
      value: { type: "integer", minimum: 1 }, optional: { type: "string" }
    }, required: ["value"] });
    expect(properties.map(property => [property.name, property.required])).toEqual([["optional", false], ["value", true]]);
    const value = properties.find(property => property.name === "value")!;
    expect(value.validate(2).ok).toBe(true);
    expect(value.validate("2").ok).toBe(false);
    expect(value.validate(0).ok).toBe(false);
  });

  it("resolves root and property references using the compiled graph", () => {
    const properties = projectJsonSchemaProperties({
      $ref: "#/$defs/Base", $defs: {
        Base: { type: "object", properties: { value: { $ref: "#/$defs/Identifier" } }, required: ["value"] },
        Identifier: { type: "string", minLength: 1 }
      }
    });
    expect(properties[0].name).toBe("value");
    expect(properties[0].required).toBe(true);
    expect(properties[0].validate("005930").ok).toBe(true);
    expect(properties[0].validate(5930).ok).toBe(false);
    expect(properties[0].schemas).toContainEqual({ type: "string", minLength: 1 });
  });

  it("uses the native registry for external references", () => {
    const properties = projectJsonSchemaProperties({ $ref: "https://example.test/base" }, { registry: {
      "https://example.test/base": { properties: { value: { type: "boolean" } } }
    } });
    expect(properties[0].validate(false).ok).toBe(true);
    expect(properties[0].validate("false").ok).toBe(false);
  });

  it("preserves embedded resource IDs and anchors", () => {
    const properties = projectJsonSchemaProperties({ $id: "https://example.test/root", properties: {
      value: { $ref: "embedded#Identifier" }
    }, $defs: { Nested: { $id: "embedded", $defs: { Identifier: { $anchor: "Identifier", type: "integer" } } } } });
    expect(properties[0].validate(3).ok).toBe(true);
    expect(properties[0].validate("3").ok).toBe(false);
  });

  it("projects allOf and alternatives with correct unconditional required metadata", () => {
    const properties = projectJsonSchemaProperties({ allOf: [
      { properties: { common: { type: "string" } }, required: ["common"] },
      { anyOf: [
        { properties: { first: { type: "integer" }, shared: { type: "boolean" } }, required: ["first", "shared"] },
        { properties: { second: { type: "string" }, shared: { type: "boolean" } }, required: ["second", "shared"] }
      ] }
    ] });
    expect(properties.map(property => [property.name, property.required]))
      .toEqual([["common", true], ["first", false], ["second", false], ["shared", true]]);
  });

  it("supports conditional properties without marking them unconditionally required", () => {
    const properties = projectJsonSchemaProperties({
      properties: { mode: { type: "string" } },
      if: { properties: { mode: { const: "write" } } },
      then: { properties: { value: { type: "integer" } }, required: ["value"] }
    });
    expect(properties.find(property => property.name === "value")?.required).toBe(false);
    expect(properties.find(property => property.name === "value")?.validate(1).ok).toBe(true);
  });

  it("projects draft-7 schema dependencies while ignoring property dependency arrays", () => {
    const properties = projectJsonSchemaProperties({
      $schema: "http://json-schema.org/draft-07/schema#",
      properties: { enabled: { type: "boolean" }, label: { type: "string" } },
      dependencies: {
        enabled: { properties: { retries: { type: "integer", minimum: 0 } }, required: ["retries"] },
        label: ["enabled"]
      }
    });
    expect(properties.map(property => [property.name, property.required]))
      .toEqual([["enabled", false], ["label", false], ["retries", false]]);
    const retries = properties.find(property => property.name === "retries")!;
    expect(retries.validate(0).ok).toBe(true);
    expect(retries.validate("0").ok).toBe(false);
  });

  it("ignores draft-7 ref siblings and terminates on recursive references", () => {
    const properties = projectJsonSchemaProperties({ $schema: "http://json-schema.org/draft-07/schema#", $ref: "#/definitions/Base",
      properties: { ignored: { type: "string" } }, definitions: {
        Base: { allOf: [{ $ref: "#/definitions/Base" }], properties: { value: { type: "integer" } } }
      }
    });
    expect(properties.map(property => property.name)).toEqual(["value"]);
  });

  it("keeps annotations and schemas independent of caller mutation", () => {
    const schema = { properties: { value: { type: "string", description: "Before" } } };
    const properties = projectJsonSchemaProperties(schema);
    schema.properties.value.type = "integer";
    expect(properties[0].validate("value").ok).toBe(true);
    (properties[0].schemas[0] as Record<string, unknown>).type = "boolean";
    expect(properties[0].validate("value").ok).toBe(true);
  });

  it("handles prototype-like keys and JSON Pointer escapes", () => {
    const schema = JSON.parse('{"properties":{"__proto__":{"type":"string"},"a/b~c":{"type":"integer"}}}');
    const properties = projectJsonSchemaProperties(schema);
    expect(properties.find(property => property.name === "__proto__")?.validate("safe").ok).toBe(true);
    expect(properties.find(property => property.name === "a/b~c")?.validate(2).ok).toBe(true);
  });
});
