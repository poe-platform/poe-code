import { describe, expect, it } from "vitest";
import type { Tool } from "tiny-mcp-client";
import { compileToolArguments } from "./index.js";

function parser(properties: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return compileToolArguments({ name: "test", inputSchema: { type: "object", properties, additionalProperties: false, ...extra } });
}

describe("schema-driven MCP arguments", () => {
  it.each(["renamed", "accessor"])("keeps compiled tool identity after caller metadata becomes %s", mode => {
    const tool: Tool = { name: "original", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } };
    const compiled = compileToolArguments(tool);
    if (mode === "renamed") tool.name = "replacement";
    else Object.defineProperty(tool, "name", { get() { throw new Error("Caller tool metadata was read again"); } });
    expect(compiled.toolName).toBe("original");
    expect(() => compiled.parse([])).toThrow("Invalid arguments for 'original'");
  });

  it.each(["2003886907", "005930", "1234567890.123456", "true", "null", "[1,2]", "", " a,b "])(
    "preserves schema-declared string %j", value => {
      expect(parser({ thread_ts: { type: "string" } }).parse(["--thread-ts", value])).toEqual({ thread_ts: value });
    }
  );

  it.each([["number", "-5.20", -5.2], ["integer", "5", 5], ["boolean", "false", false], ["null", "null", null]])(
    "parses a %s without dropping falsey values", (type, value, expected) => {
      expect(parser({ value: { type } }).parse(["--value", String(value)])).toEqual({ value: expected });
    }
  );

  it("accepts --flag=value and schema field=value consistently", () => {
    const parse = parser({ pageNumber: { type: "integer" } });
    expect(parse.parse(["--page-number=5"])).toEqual({ pageNumber: 5 });
    expect(parse.parse(["pageNumber=5"])).toEqual({ pageNumber: 5 });
    expect(parse.parse(["pageNumber:=5"])).toEqual({ pageNumber: 5 });
  });

  it("parses nested JSON objects as a single value", () => {
    expect(parser({ data: { type: "object" } }).parse(["data:{\"a\":{\"b\":[1,2]},\"url\":\"https://example.test/a:b\"}"]))
      .toEqual({ data: { a: { b: [1, 2] }, url: "https://example.test/a:b" } });
  });

  it("keeps arrays of JSON objects intact", () => {
    const parse = parser({ cells: { type: "array", items: { type: "object", required: ["x", "y"] } } });
    expect(parse.parse(["--cells", '[{"x":1,"y":2},{"x":3,"y":4}]']))
      .toEqual({ cells: [{ x: 1, y: 2 }, { x: 3, y: 4 }] });
    expect(parse.parse(["--cells", '{"x":1,"y":2}', "--cells", '{"x":3,"y":4}']))
      .toEqual({ cells: [{ x: 1, y: 2 }, { x: 3, y: 4 }] });
  });

  it("preserves commas within string array elements", () => {
    const parse = parser({ tags: { type: "array", items: { type: "string" } } });
    expect(parse.parse(["--tags", "a,b"])).toEqual({ tags: ["a,b"] });
    expect(parse.parse(["--tags", "first", "--tags", "second"])).toEqual({ tags: ["first", "second"] });
    expect(parse.parse(["--tags", '["a,b","c"]'])).toEqual({ tags: ["a,b", "c"] });
    expect(parse.parse(["--tags", "[]"])).toEqual({ tags: [] });
  });

  it("parses numeric and boolean array elements by their schema", () => {
    expect(parser({ values: { type: "array", items: { type: "integer" } } }).parse(["--values", "1", "--values", "2"]))
      .toEqual({ values: [1, 2] });
    expect(parser({ values: { type: "array", items: { type: "boolean" } } }).parse(["--values", "false"]))
      .toEqual({ values: [false] });
  });

  it("honors raw JSON without requiring separate flags or dropping fields", () => {
    const parse = parser({ cells: { type: "array" }, subject: { type: "string" } }, { required: ["cells", "subject"] });
    expect(parse.parse(["--raw", '{"cells":[{"x":1,"y":2}],"subject":"hello"}']))
      .toEqual({ cells: [{ x: 1, y: 2 }], subject: "hello" });
  });

  it("validates required fields after reading raw JSON", () => {
    expect(() => parser({ subject: { type: "string" } }, { required: ["subject"] }).parse(["--raw", "{}"]))
      .toThrow("subject");
  });

  it.each(["[]", "null", "5", '"text"'])("rejects raw non-object input %s", value => {
    expect(() => parser({}).parse(["--raw", value])).toThrow("JSON object");
  });

  it("rejects ambiguous raw and named input instead of overwriting it", () => {
    expect(() => parser({ value: { type: "string" } }).parse(["--raw", '{"value":"first"}', "--value", "second"]))
      .toThrow("cannot be combined");
  });

  it("validates constraints and rejects incorrect numeric forms", () => {
    const parse = parser({ value: { type: "integer", minimum: 1, maximum: 10 } });
    for (const value of ["0", "11", "1.5", "NaN", "Infinity", "1abc", "0x10", "01"])
      expect(() => parse.parse(["--value", value])).toThrow();
  });

  it("rejects repeated scalar values", () => {
    expect(() => parser({ value: { type: "string" } }).parse(["--value", "first", "--value", "second"]))
      .toThrow("value");
  });

  it("validates nullable and union types without coercing allowed strings", () => {
    const parse = parser({ value: { anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }] } });
    expect(parse.parse(["--value", "5"])).toEqual({ value: "5" });
    expect(parse.parse(["value:=5"])).toEqual({ value: 5 });
    expect(parse.parse(["value:=null"])).toEqual({ value: null });
  });

  it("parses union object branches and validates the selected branch", () => {
    const parse = parser({ data: { oneOf: [
      { type: "object", properties: { mode: { const: "read" } }, required: ["mode"] },
      { type: "object", properties: { mode: { const: "write" }, value: { type: "integer" } }, required: ["mode", "value"] }
    ] } });
    expect(parse.parse(["--data", '{"mode":"write","value":2}'])).toEqual({ data: { mode: "write", value: 2 } });
    expect(() => parse.parse(["--data", '{"mode":"write"}'])).toThrow("data");
  });

  it("uses defaults only with --yes and keeps explicit falsey values", () => {
    const parse = parser({ retries: { type: "integer", default: 3 }, enabled: { type: "boolean", default: true } });
    expect(parse.parse([])).toEqual({});
    expect(parse.parse(["--yes"])).toEqual({ enabled: true, retries: 3 });
    expect(parse.parse([], { yes: true })).toEqual({ enabled: true, retries: 3 });
    expect(parse.parse(["--yes", "--retries", "0", "--enabled", "false"])).toEqual({ retries: 0, enabled: false });
  });

  it("supports standalone boolean switches without inventing negation aliases", () => {
    const parse = parser({ enabled: { type: "boolean" }, no_cache: { type: "string" } });
    expect(parse.parse(["--enabled", "--no-cache", "value"])).toEqual({ enabled: true, no_cache: "value" });
    expect(() => parse.parse(["--no-enabled"])).toThrow("Unknown");
  });

  it("allocates deterministic flags for collisions and reserved names", () => {
    const properties = Object.fromEntries(["Query", "query", "query_2", "raw", "yes", "help", "no_cache", "nocache"].map(name => [name, { type: "string" }]));
    const first = parser(properties);
    const second = parser(Object.fromEntries(Object.entries(properties).reverse()));
    expect(first.parameters).toEqual(second.parameters);
    const flags = first.parameters.map(parameter => parameter.flag);
    expect(new Set(flags).size).toBe(flags.length);
    expect(flags).not.toContain("--raw");
    expect(flags).not.toContain("--yes");
    expect(flags).not.toContain("--help");
    const args = first.parameters.flatMap(parameter => [parameter.flag, parameter.name]);
    expect(first.parse(args)).toEqual(Object.fromEntries(Object.keys(properties).map(name => [name, name])));
  });

  it("treats prototype-like names as ordinary own properties", () => {
    const properties = JSON.parse('{"__proto__":{"type":"string"},"constructor":{"type":"string"},"toString":{"type":"string"}}');
    const parse = parser(properties);
    const value = parse.parse(["__proto__=safe", "constructor=ctor", "toString=text"]);
    expect(Object.hasOwn(value, "__proto__")).toBe(true);
    expect(value.__proto__).toBe("safe");
    expect(value.constructor).toBe("ctor");
    expect({}.toString).toBe(Object.prototype.toString);
  });

  it("resolves property types from internal JSON Schema references", () => {
    const parse = parser({ value: { $ref: "#/$defs/Identifier" } }, { $defs: { Identifier: { type: "string" } } });
    expect(parse.parse(["--value", "005930"])).toEqual({ value: "005930" });
  });

  it("exposes properties declared through root references and allOf", () => {
    const tool: Tool = { name: "composed", inputSchema: {
      $defs: { Base: { type: "object", properties: { page: { type: "integer" } }, required: ["page"] } },
      allOf: [{ $ref: "#/$defs/Base" }, { properties: { query: { type: "string" } } }]
    } };
    const parse = compileToolArguments(tool);
    expect(parse.parse(["--page", "2", "--query", "005930"])).toEqual({ page: 2, query: "005930" });
    expect(() => parse.parse(["--query", "x"])).toThrow("page");
  });

  it("accepts flags declared by draft-7 schema dependencies and validates their trigger", () => {
    const parse = parser({ enabled: { type: "boolean" } }, {
      $schema: "http://json-schema.org/draft-07/schema#",
      additionalProperties: true,
      dependencies: {
        enabled: { properties: { retries: { type: "integer", minimum: 0 } }, required: ["retries"] }
      }
    });
    expect(parse.parameters.find(parameter => parameter.name === "retries"))
      .toMatchObject({ flag: "--retries", required: false });
    expect(parse.parse(["--enabled", "--retries", "0"]))
      .toEqual({ enabled: true, retries: 0 });
    expect(parse.parse(["--raw", '{"enabled":true,"retries":0}']))
      .toEqual({ enabled: true, retries: 0 });
    expect(() => parse.parse(["--enabled"])).toThrow("retries");
    expect(() => parse.parse(["--enabled", "--retries", "-1"])).toThrow("retries");
  });

  it("never mutates the caller's schemas or shares default objects across calls", () => {
    const properties = { value: { type: "object", default: { nested: [1] } } };
    const parse = parser(properties);
    const first = parse.parse(["--yes"]);
    (first.value as { nested: number[] }).nested.push(2);
    expect(parse.parse(["--yes"])).toEqual({ value: { nested: [1] } });
    expect(properties.value.default).toEqual({ nested: [1] });
  });

  it("rejects unknown, missing and positional inputs instead of dropping them", () => {
    const parse = parser({ value: { type: "string" } });
    for (const args of [["--unknown", "x"], ["unknown=x"], ["--value"], ["positional"], ["--raw"], ["--raw", "not-json"]])
      expect(() => parse.parse(args)).toThrow();
  });

  it("bounds input bytes before JSON parsing", () => {
    const parse = parser({ value: { type: "string" } });
    expect(() => parse.parse(["--value", "too long"], { maxInputBytes: 5 })).toThrow("byte limit");
    expect(() => parse.parse([], { maxInputBytes: 0 })).toThrow("positive safe integer");
  });

  it("keeps external reference documents independent of later caller mutation", () => {
    const external = { properties: { value: { type: "string" } } };
    const parse = compileToolArguments({ name: "external", inputSchema: { $ref: "https://example.test/schema" } }, {
      registry: { "https://example.test/schema": external }
    });
    external.properties.value.type = "number";
    expect(parse.parse(["--value", "005930"])).toEqual({ value: "005930" });
  });

  it("combines repeated JSON array values without turning strings into arrays of characters", () => {
    const parse = parser({ values: { type: "array", items: { type: "string" } } });
    expect(parse.parse(["--values", '["first","second"]', "--values", '["third"]']))
      .toEqual({ values: ["first", "second", "third"] });
  });

  it("rejects raw input with non-finite or rounded integer numbers", () => {
    const parse = parser({ value: { type: "number" } });
    for (const json of ['{"value":9007199254740993}', '{"value":1e999}'])
      expect(() => parse.parse(["--raw", json])).toThrow();
    expect(parse.parse(["--raw", '{"value":9007199254740992}'])).toEqual({ value: 9007199254740992 });
  });

  it("rejects lossy typed integer assignments while preserving large string IDs", () => {
    expect(() => parser({ value: { type: "integer" } }).parse(["value:=9007199254740993"])).toThrow();
    expect(parser({ value: { type: "string" } }).parse(["--value", "9007199254740993"]))
      .toEqual({ value: "9007199254740993" });
  });

  it("accepts JSON item sequences without splitting nested object commas", () => {
    expect(parser({ cells: { type: "array", items: { type: "object" } } })
      .parse(["--cells", '{"x":1,"y":2},{"x":3,"y":4}']))
      .toEqual({ cells: [{ x: 1, y: 2 }, { x: 3, y: 4 }] });
    expect(parser({ values: { type: "array", items: { type: "integer" } } }).parse(["--values", "1,2,3"]))
      .toEqual({ values: [1, 2, 3] });
    expect(parser({ values: { type: "array", items: { type: "string" } } }).parse(["--values", '"first,a","second,b"']))
      .toEqual({ values: ["first,a", "second,b"] });
  });

  it("parses structured values for unconstrained schemas", () => {
    expect(parser({ data: {} }).parse(["--data", '{"nested":[{"value":1}]}']))
      .toEqual({ data: { nested: [{ value: 1 }] } });
  });

  it("preserves escaped JSON strings containing numeric text", () => {
    const raw = JSON.stringify({ value: 'quote: "9007199254740993" \\ 1e999' });
    expect(parser({ value: { type: "string" } }).parse(["--raw", raw]))
      .toEqual({ value: 'quote: "9007199254740993" \\ 1e999' });
  });
});
