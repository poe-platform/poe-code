import { expect, it } from "vitest";
import { encodeHeaderValue, decodeHeaderValue, getParameterHeaders } from "./headers.js";

it.each([
  "normal",
  "Hello, 世界",
  " padded ",
  "line1\nline2",
  "=?base64?literal?=",
  "a\tb",
  "\uFEFFvalue"
])("round trips header value %j", (value) => {
  expect(decodeHeaderValue(encodeHeaderValue(value))).toBe(value);
});
it.each(["Hello, 世界", " padded ", "line1\nline2", "=?base64?literal?="])(
  "encodes unsafe or ambiguous %j",
  (value) => {
    expect(encodeHeaderValue(value)).toBe(`=?base64?${Buffer.from(value).toString("base64")}?=`);
  }
);
it("extracts annotations from nested static property paths", () => {
  expect(
    getParameterHeaders({
      type: "object",
      properties: {
        tenant: {
          type: "object",
          properties: { id: { type: "string", "x-mcp-header": "Tenant" } }
        },
        count: { type: "integer", "x-mcp-header": "Count" }
      }
    })
  ).toEqual([
    { name: "Mcp-Param-Tenant", path: ["tenant", "id"], type: "string" },
    { name: "Mcp-Param-Count", path: ["count"], type: "integer" }
  ]);
});
it.each(["", "white space", "x\nInjected", "世界"])(
  "rejects invalid annotation name %j",
  (name) => {
    expect(() =>
      getParameterHeaders({
        type: "object",
        properties: { value: { type: "string", "x-mcp-header": name } }
      })
    ).toThrow();
  }
);
it.each(["number", "object", "array", ["string", "null"]])(
  "rejects nonprimitive annotation type %j",
  (type) => {
    expect(() =>
      getParameterHeaders({
        type: "object",
        properties: { value: { type, "x-mcp-header": "Value" } }
      })
    ).toThrow();
  }
);
it("rejects case-insensitive duplicate annotations", () => {
  expect(() =>
    getParameterHeaders({
      type: "object",
      properties: {
        first: { type: "string", "x-mcp-header": "Tenant" },
        second: { type: "string", "x-mcp-header": "tenant" }
      }
    })
  ).toThrow();
});
it.each(["oneOf", "allOf", "anyOf", "prefixItems"])(
  "rejects annotations reached through %s",
  (keyword) => {
    expect(() =>
      getParameterHeaders({
        type: "object",
        [keyword]: [
          { type: "object", properties: { value: { type: "string", "x-mcp-header": "Value" } } }
        ]
      })
    ).toThrow();
  }
);
it.each(["$defs", "definitions", "patternProperties", "dependentSchemas"])(
  "rejects annotations inside %s maps",
  (keyword) => {
    expect(() =>
      getParameterHeaders({
        type: "object",
        [keyword]: { value: { type: "string", "x-mcp-header": "Value" } }
      })
    ).toThrow();
  }
);
it.each([
  "items",
  "additionalProperties",
  "not",
  "contains",
  "if",
  "then",
  "else",
  "propertyNames",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contentSchema"
])("rejects annotations reached through %s", (keyword) => {
  expect(() =>
    getParameterHeaders({ type: "object", [keyword]: { type: "string", "x-mcp-header": "Value" } })
  ).toThrow();
});
it("does not interpret literal default objects as schemas", () => {
  expect(
    getParameterHeaders({
      type: "object",
      properties: { value: { type: "object", default: { "x-mcp-header": "literal" } } }
    })
  ).toEqual([]);
});
it("bounds traversal and rejects cyclic schema objects", () => {
  const schema: Record<string, unknown> = { type: "object" };
  schema.properties = { loop: schema };
  expect(() => getParameterHeaders(schema)).toThrow();
});

import { createParameterHeaders, validateParameterHeaders } from "./headers.js";

it("mirrors primitive values and omits absent property paths", () => {
  const definitions = getParameterHeaders({
    type: "object",
    properties: {
      count: { type: "integer", "x-mcp-header": "Count" },
      enabled: { type: "boolean", "x-mcp-header": "Enabled" },
      text: { type: "string", "x-mcp-header": "Text" },
      missing: { type: "string", "x-mcp-header": "Missing" }
    }
  });
  expect(createParameterHeaders(definitions, { count: -7, enabled: false, text: "世界" })).toEqual({
    "Mcp-Param-Count": "-7",
    "Mcp-Param-Enabled": "false",
    "Mcp-Param-Text": "=?base64?5LiW55WM?="
  });
});
it("does not mirror inherited argument values", () => {
  const definitions = getParameterHeaders({
    type: "object",
    properties: { tenant: { type: "string", "x-mcp-header": "Tenant" } }
  });
  expect(createParameterHeaders(definitions, Object.create({ tenant: "private" }))).toEqual({});
});
it.each([1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "7"])(
  "rejects unsafe integer mirror values %j",
  (count) => {
    const definitions = getParameterHeaders({
      type: "object",
      properties: { count: { type: "integer", "x-mcp-header": "Count" } }
    });
    expect(() => createParameterHeaders(definitions, { count })).toThrow();
  }
);
it("rejects recognized headers when the argument is absent", () => {
  const definitions = getParameterHeaders({
    type: "object",
    properties: { tenant: { type: "string", "x-mcp-header": "Tenant" } }
  });
  expect(validateParameterHeaders(definitions, {}, { "mcp-param-tenant": "fake" })).toBeDefined();
});
it("ignores unrecognized extension headers", () => {
  expect(validateParameterHeaders([], {}, { "mcp-param-unknown": "value" })).toBeUndefined();
});
it("rejects unpaired Unicode surrogates before generating a misleading mirror", () => {
  expect(() => encodeHeaderValue("\ud800")).toThrow();
});
