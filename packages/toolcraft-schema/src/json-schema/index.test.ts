import { describe, expect, it } from "vitest";
import { compileJsonSchema, formatIssues } from "./index.js";

describe("compileJsonSchema", () => {
  it("validates boolean and object schemas", () => {
    expect(compileJsonSchema(true).validate("anything")).toEqual({
      ok: true,
      value: "anything"
    });
    expect(compileJsonSchema(false).validate("anything")).toMatchObject({ ok: false });
    expect(
      compileJsonSchema({
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } }
      }).validate({ name: "Ada" })
    ).toEqual({ ok: true, value: { name: "Ada" } });
  });

  it("compiles patterns and references eagerly", () => {
    expect(() => compileJsonSchema({ pattern: "[" })).toThrow("Invalid regular expression");
    expect(() => compileJsonSchema({ $ref: "#/$defs/missing" })).toThrow("Unresolvable $ref");
  });

  it("rejects malformed schemas at compile time", () => {
    expect(() => compileJsonSchema({ type: "text" })).toThrow("type must be a JSON Schema type");
    expect(() => compileJsonSchema({ required: "name" })).toThrow(
      "required must be an array of strings"
    );
    expect(() => compileJsonSchema({ minimum: "zero" })).toThrow("minimum must be a number");
  });

  it("formats issues for MCP error messages", () => {
    expect(
      formatIssues([
        {
          path: ["name"],
          expected: "string",
          received: "number",
          message: "must be string",
          keyword: "type"
        }
      ])
    ).toBe("data/name must be string");
  });
});
