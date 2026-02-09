import { describe, it, expect } from "vitest";
import { defineSchema } from "./schema.js";

describe("defineSchema", () => {
  describe("basic schema creation", () => {
    it("creates schema with required string field", () => {
      const schema = defineSchema({
        name: { type: "string", description: "User name" },
      });

      expect(schema).toEqual({
        type: "object",
        properties: {
          name: { type: "string", description: "User name" },
        },
        required: ["name"],
      });
    });

    it("creates schema with optional field", () => {
      const schema = defineSchema({
        count: { type: "number", optional: true },
      });

      expect(schema).toEqual({
        type: "object",
        properties: {
          count: { type: "number" },
        },
        required: [],
      });
    });

    it("creates schema with mixed required and optional fields", () => {
      const schema = defineSchema({
        a: { type: "string" },
        b: { type: "number", optional: true },
      });

      expect(schema).toEqual({
        type: "object",
        properties: {
          a: { type: "string" },
          b: { type: "number" },
        },
        required: ["a"],
      });
    });

    it("handles empty schema", () => {
      const schema = defineSchema({});

      expect(schema).toEqual({
        type: "object",
        properties: {},
        required: [],
      });
    });
  });

  describe("property types", () => {
    it("creates schema with string type", () => {
      const schema = defineSchema({
        field: { type: "string" },
      });
      expect(schema.properties.field.type).toBe("string");
    });

    it("creates schema with number type", () => {
      const schema = defineSchema({
        field: { type: "number" },
      });
      expect(schema.properties.field.type).toBe("number");
    });

    it("creates schema with boolean type", () => {
      const schema = defineSchema({
        field: { type: "boolean" },
      });
      expect(schema.properties.field.type).toBe("boolean");
    });

    it("creates schema with object type", () => {
      const schema = defineSchema({
        field: { type: "object" },
      });
      expect(schema.properties.field.type).toBe("object");
    });

    it("creates schema with array type", () => {
      const schema = defineSchema({
        field: { type: "array" },
      });
      expect(schema.properties.field.type).toBe("array");
    });

    it("creates schema with all property types", () => {
      const schema = defineSchema({
        str: { type: "string" },
        num: { type: "number" },
        bool: { type: "boolean" },
        obj: { type: "object" },
        arr: { type: "array" },
      });

      expect(schema.properties).toEqual({
        str: { type: "string" },
        num: { type: "number" },
        bool: { type: "boolean" },
        obj: { type: "object" },
        arr: { type: "array" },
      });
      expect(schema.required).toEqual(["str", "num", "bool", "obj", "arr"]);
    });
  });

  describe("descriptions", () => {
    it("preserves descriptions on properties", () => {
      const schema = defineSchema({
        message: { type: "string", description: "The prompt" },
        temperature: { type: "number", description: "Sampling temperature" },
      });

      expect(schema.properties.message.description).toBe("The prompt");
      expect(schema.properties.temperature.description).toBe(
        "Sampling temperature"
      );
    });

    it("omits description when not provided", () => {
      const schema = defineSchema({
        field: { type: "string" },
      });

      expect(schema.properties.field).toEqual({ type: "string" });
      expect("description" in schema.properties.field).toBe(false);
    });

    it("handles empty string description", () => {
      const schema = defineSchema({
        field: { type: "string", description: "" },
      });

      expect(schema.properties.field.description).toBe("");
    });

    it("handles long descriptions", () => {
      const longDesc = "A".repeat(1000);
      const schema = defineSchema({
        field: { type: "string", description: longDesc },
      });

      expect(schema.properties.field.description).toBe(longDesc);
    });

    it("handles special characters in descriptions", () => {
      const schema = defineSchema({
        field: {
          type: "string",
          description: 'Contains "quotes", newlines\nand\ttabs',
        },
      });

      expect(schema.properties.field.description).toBe(
        'Contains "quotes", newlines\nand\ttabs'
      );
    });
  });

  describe("required array behavior", () => {
    it("includes all required fields in required array", () => {
      const schema = defineSchema({
        a: { type: "string" },
        b: { type: "number" },
        c: { type: "boolean" },
      });

      expect(schema.required).toContain("a");
      expect(schema.required).toContain("b");
      expect(schema.required).toContain("c");
      expect(schema.required).toHaveLength(3);
    });

    it("excludes all optional fields from required array", () => {
      const schema = defineSchema({
        a: { type: "string", optional: true },
        b: { type: "number", optional: true },
        c: { type: "boolean", optional: true },
      });

      expect(schema.required).toEqual([]);
    });

    it("correctly partitions required and optional", () => {
      const schema = defineSchema({
        required1: { type: "string" },
        optional1: { type: "number", optional: true },
        required2: { type: "boolean" },
        optional2: { type: "object", optional: true },
        required3: { type: "array" },
      });

      expect(schema.required).toContain("required1");
      expect(schema.required).toContain("required2");
      expect(schema.required).toContain("required3");
      expect(schema.required).not.toContain("optional1");
      expect(schema.required).not.toContain("optional2");
      expect(schema.required).toHaveLength(3);
    });

    it("optional: false is treated as required", () => {
      const schema = defineSchema({
        field: { type: "string", optional: false },
      });

      expect(schema.required).toContain("field");
    });
  });

  describe("field naming", () => {
    it("handles single character field names", () => {
      const schema = defineSchema({
        a: { type: "string" },
        b: { type: "number" },
      });

      expect(schema.properties.a).toBeDefined();
      expect(schema.properties.b).toBeDefined();
    });

    it("handles long field names", () => {
      const longName = "a".repeat(100);
      const schema = defineSchema({
        [longName]: { type: "string" },
      });

      expect(schema.properties[longName]).toBeDefined();
      expect(schema.required).toContain(longName);
    });

    it("handles camelCase field names", () => {
      const schema = defineSchema({
        firstName: { type: "string" },
        lastName: { type: "string" },
      });

      expect(schema.properties.firstName).toBeDefined();
      expect(schema.properties.lastName).toBeDefined();
    });

    it("handles snake_case field names", () => {
      const schema = defineSchema({
        first_name: { type: "string" },
        last_name: { type: "string" },
      });

      expect(schema.properties.first_name).toBeDefined();
      expect(schema.properties.last_name).toBeDefined();
    });

    it("handles field names with numbers", () => {
      const schema = defineSchema({
        field1: { type: "string" },
        field2: { type: "number" },
        "2field": { type: "boolean" },
      });

      expect(schema.properties.field1).toBeDefined();
      expect(schema.properties.field2).toBeDefined();
      expect(schema.properties["2field"]).toBeDefined();
    });

    it("handles field names with special characters", () => {
      const schema = defineSchema({
        "field-name": { type: "string" },
        "field.name": { type: "number" },
      });

      expect(schema.properties["field-name"]).toBeDefined();
      expect(schema.properties["field.name"]).toBeDefined();
    });
  });

  describe("schema structure", () => {
    it("always has type: object at root", () => {
      const schema = defineSchema({
        field: { type: "string" },
      });

      expect(schema.type).toBe("object");
    });

    it("always has properties object", () => {
      const schema = defineSchema({});

      expect(schema.properties).toBeDefined();
      expect(typeof schema.properties).toBe("object");
    });

    it("always has required array", () => {
      const schema = defineSchema({});

      expect(schema.required).toBeDefined();
      expect(Array.isArray(schema.required)).toBe(true);
    });

    it("does not include optional flag in output properties", () => {
      const schema = defineSchema({
        field: { type: "string", optional: true },
      });

      expect("optional" in schema.properties.field).toBe(false);
    });
  });

  describe("many fields", () => {
    it("handles 10 fields", () => {
      const schema = defineSchema({
        f1: { type: "string" },
        f2: { type: "number" },
        f3: { type: "boolean" },
        f4: { type: "object" },
        f5: { type: "array" },
        f6: { type: "string", optional: true },
        f7: { type: "number", optional: true },
        f8: { type: "boolean", optional: true },
        f9: { type: "object", optional: true },
        f10: { type: "array", optional: true },
      });

      expect(Object.keys(schema.properties)).toHaveLength(10);
      expect(schema.required).toHaveLength(5);
    });

    it("handles 50 fields", () => {
      const def: Record<string, { type: "string"; optional?: boolean }> = {};
      for (let i = 0; i < 50; i++) {
        def[`field${i}`] = { type: "string", optional: i % 2 === 0 };
      }
      const schema = defineSchema(def);

      expect(Object.keys(schema.properties)).toHaveLength(50);
      expect(schema.required).toHaveLength(25);
    });
  });

  describe("JSON Schema validity", () => {
    it("produces valid JSON Schema structure", () => {
      const schema = defineSchema({
        name: { type: "string", description: "User name" },
        age: { type: "number", optional: true },
      });

      // Verify it can be JSON stringified and parsed
      const json = JSON.stringify(schema);
      const parsed = JSON.parse(json);

      expect(parsed.type).toBe("object");
      expect(parsed.properties).toBeDefined();
      expect(parsed.required).toBeDefined();
    });

    it("produces schema that matches JSON Schema spec", () => {
      const schema = defineSchema({
        name: { type: "string" },
      });

      // JSON Schema requires these fields for object type
      expect(schema.type).toBe("object");
      expect(schema.properties).toBeDefined();
      // Required is an array of strings
      expect(Array.isArray(schema.required)).toBe(true);
      schema.required?.forEach((r) => expect(typeof r).toBe("string"));
    });
  });
});
