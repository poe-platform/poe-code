import { expect, it, vi } from "vitest";
import { defineCommand, defineGroup } from "./index.js";
import { convertJsonSchema } from "./json-schema-converter.js";
import { createMCPServer } from "./mcp.js";
import { createSDK } from "./sdk.js";
import { runCLI } from "./cli.js";

it.each([
  { field: { type: "integer" as const, multipleOf: 3, default: 6 }, expected: 6 },
  { field: { type: "string" as const, const: "assistant" }, expected: "assistant" }
])("retains applied SDK defaults for native object fields $field", async ({ field, expected }) => {
  const params = convertJsonSchema({ type: "object", properties: { value: field }, required: ["value"], additionalProperties: false });
  if (params.kind !== "object") throw new Error("Expected object projection");
  const root = defineGroup({ name: "audit", children: [defineCommand({ name: "value", params, handler: ({ params }) => params })] });
  await expect(createSDK(root, { errorReports: false }).value({})).resolves.toEqual({ value: expected });
});

it("isolates mutable native SDK defaults between calls", async () => {
  const source = { type: "object" as const, properties: { value: { type: "object" as const,
    properties: { items: { type: "array" as const, items: { type: "string" as const } } },
    default: { items: [] }, minProperties: 1 } }, required: ["value"], additionalProperties: false };
  const params = convertJsonSchema(source);
  if (params.kind !== "object") throw new Error("Expected object projection");
  const root = defineGroup({ name: "audit", children: [defineCommand({ name: "value", params, handler: ({ params }) => {
    const value = (params as { value: { items: string[] } }).value;
    value.items.push("used");
    return value.items.length;
  } })] });
  const sdk = createSDK(root, { errorReports: false });
  await expect(sdk.value({})).resolves.toBe(1);
  await expect(sdk.value({})).resolves.toBe(1);
  expect(source.properties.value.default.items).toEqual([]);
});

it("rejects invalid native SDK defaults before handler execution", async () => {
  const params = convertJsonSchema({ type: "object", properties: { value: { type: "integer", multipleOf: 3, default: 4 } }, required: ["value"] });
  if (params.kind !== "object") throw new Error("Expected object projection");
  const handler = vi.fn(() => "accepted");
  const root = defineGroup({ name: "audit", children: [defineCommand({ name: "value", params, handler })] });
  await expect(createSDK(root, { errorReports: false }).value({})).rejects.toThrow("multiple");
  expect(handler).not.toHaveBeenCalled();
});

it("enforces native object intersections across SDK, CLI and MCP", async () => {
  const source = { type: "object" as const, allOf: [
    { type: "object" as const, properties: { a: { type: "string" as const } }, required: ["a"] },
    { type: "object" as const, properties: { b: { type: "number" as const } }, required: ["b"] }
  ] };
  const params = convertJsonSchema(source);
  if (params.kind !== "object") throw new Error("Expected object projection");
  const handler = vi.fn(() => "accepted");
  const root = defineGroup({ name: "audit", children: [defineCommand({
    name: "value", scope: ["cli", "sdk", "mcp"], params, handler
  })] });
  const session = createMCPServer(root, { name: "audit", version: "1", errorReports: false })
    .createMessageSession(() => undefined);
  const previousExitCode = process.exitCode;
  try {
    await expect(createSDK(root, { errorReports: false }).value({ a: "yes" })).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
    await expect(createSDK(root, { errorReports: false }).value({ a: "yes", b: 1 })).resolves.toBe("accepted");
    process.exitCode = 0;
    await runCLI(root, { argv: ["node", "audit", "value", "--a", "yes", "--b", "1"],
      errorReports: false, outputEmitter: () => {} });
    expect(process.exitCode).toBe(0);
    expect(handler).toHaveBeenCalledTimes(2);
    const _meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };
    expect(await session.handleMessage("tools/list", { _meta })).toMatchObject({ result: { tools: [{ inputSchema: source }] } });
    expect(await session.handleMessage("tools/call", { name: "audit__value", arguments: { a: "yes" }, _meta }))
      .toMatchObject({ error: { code: -32602 } });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(await session.handleMessage("tools/call", { name: "audit__value", arguments: { a: "yes", b: 1 }, _meta }))
      .toHaveProperty("result");
    expect(handler).toHaveBeenCalledTimes(3);
  } finally { process.exitCode = previousExitCode; session.close(); }
});

it("enforces native assertions and permits upstream-open properties through the SDK", async () => {
  const source = { type: "object" as const, properties: { value: { type: "integer" as const, multipleOf: 3 } }, required: ["value"] };
  const params = convertJsonSchema(source);
  if (params.kind !== "object") throw new Error("Expected object projection");
  const handler = vi.fn(({ params }) => params);
  const root = defineGroup({ name: "audit", children: [defineCommand({ name: "value", params, handler })] });
  const sdk = createSDK(root, { errorReports: false });
  await expect(sdk.value({ value: 4 })).rejects.toThrow();
  expect(handler).not.toHaveBeenCalled();
  await expect(sdk.value({ value: 3, extra: true })).resolves.toEqual({ value: 3, extra: true });
});

it("retains SDK key conventions when validating native nested input", async () => {
  const source = { type: "object" as const, properties: { user_info: { type: "object" as const,
    properties: { first_name: { type: "string" as const, minLength: 3 } }, required: ["first_name"] } }, required: ["user_info"] };
  const params = convertJsonSchema(source);
  if (params.kind !== "object") throw new Error("Expected object projection");
  const root = defineGroup({ name: "audit", children: [defineCommand({ name: "value", params, handler: ({ params }) => params })] });
  const sdk = createSDK(root, { errorReports: false });
  await expect(sdk.value({ userInfo: { firstName: "yes", extra: true } })).resolves.toEqual({ user_info: { first_name: "yes", extra: true } });
  await expect(sdk.value({ userInfo: { firstName: "x" } })).rejects.toThrow();
});

it("preserves native MCP property names and typed result names", async () => {
  const source = { type: "object" as const, properties: { firstName: { type: "string" as const, minLength: 3 } }, required: ["firstName"] };
  const params = convertJsonSchema(source);
  if (params.kind !== "object") throw new Error("Expected object projection");
  const root = defineGroup({ name: "audit", children: [defineCommand({ name: "value", scope: ["mcp"], params, result: params, handler: ({ params }) => params })] });
  const session = createMCPServer(root, { name: "audit", version: "1", errorReports: false }).createMessageSession();
  const _meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };
  try {
    expect(await session.handleMessage("tools/list", { _meta })).toMatchObject({ result: { tools: [{ inputSchema: source, outputSchema: source }] } });
    expect(await session.handleMessage("tools/call", { _meta, name: "audit__value", arguments: { firstName: "yes", extra: true } }))
      .toMatchObject({ result: { structuredContent: { firstName: "yes", extra: true } } });
    expect(await session.handleMessage("tools/call", { _meta, name: "audit__value", arguments: { firstName: "x" } }))
      .toMatchObject({ error: { code: -32602 } });
  } finally { session.close(); }
});

it("enforces whole native input assertions before invoking CLI handlers", async () => {
  const params = convertJsonSchema({ type: "object", properties: { value: { type: "integer", multipleOf: 3 } }, required: ["value"] });
  if (params.kind !== "object") throw new Error("Expected object projection");
  const handler = vi.fn(() => "accepted");
  const root = defineGroup({ name: "audit", children: [defineCommand({ name: "value", params, handler })] });
  const previousExitCode = process.exitCode;
  try {
    process.exitCode = 0;
    await runCLI(root, { argv: ["node", "audit", "value", "--value", "4"], errorReports: false, outputEmitter: () => {} });
    expect(process.exitCode).toBe(1);
    expect(handler).not.toHaveBeenCalled();
    process.exitCode = 0;
    await runCLI(root, { argv: ["node", "audit", "value", "--value", "3"], errorReports: false, outputEmitter: () => {} });
    expect(process.exitCode).toBe(0);
    expect(handler).toHaveBeenCalledOnce();
  } finally { process.exitCode = previousExitCode; }
});

it("does not apply defaults from inactive native composition branches", async () => {
  const params = convertJsonSchema({ type: "object", oneOf: [
    { type: "object", properties: { mode: { const: "a" }, a: { type: "number", default: 1 } }, required: ["mode"], additionalProperties: false },
    { type: "object", properties: { mode: { const: "b" }, b: { type: "number", default: 2 } }, required: ["mode"], additionalProperties: false }
  ] });
  if (params.kind !== "object") throw new Error("Expected object projection");
  const root = defineGroup({ name: "audit", children: [defineCommand({ name: "value", params, handler: ({ params }) => params })] });
  const sdk = createSDK(root, { errorReports: false });
  await expect(sdk.value({ mode: "a" })).resolves.toEqual({ mode: "a" });
  await expect(sdk.value({ mode: "b" })).resolves.toEqual({ mode: "b" });
});

it.each([
  { name: "array object optional field", schema: { type: "object", properties: { entries: { type: "array", items: { type: "object", properties: { value: { type: "number", multipleOf: 3 } } } } } }, input: { entries: [{ value: undefined }] }, expected: { entries: [{}] } },
  { name: "record object optional field", schema: { type: "object", properties: { entries: { type: "object", additionalProperties: { type: "object", properties: { value: { type: "number", multipleOf: 3 } } } } } }, input: { entries: { first: { value: undefined } } }, expected: { entries: { first: {} } } },
  { name: "optional scalar", schema: { type: "object", properties: { value: { type: "number", multipleOf: 3 } } }, input: { value: undefined }, expected: {} },
  { name: "optional default", schema: { type: "object", properties: { value: { type: "number", multipleOf: 3, default: 6 } } }, input: { value: undefined }, expected: { value: 6 } },
  { name: "nested optional scalar", schema: { type: "object", properties: { nested: { type: "object", properties: { value: { type: "number", multipleOf: 3 } } } } }, input: { nested: { value: undefined } }, expected: { nested: {} } },
])("retains SDK optional undefined semantics for native $name", async ({ schema, input, expected }) => {
  const params = convertJsonSchema(schema as Parameters<typeof convertJsonSchema>[0]);
  if (params.kind !== "object") throw new Error("Expected object projection");
  const root = defineGroup({ name: "audit", children: [defineCommand({ name: "value", params, handler: ({ params }) => params })] });
  await expect(createSDK(root, { errorReports: false }).value(input)).resolves.toEqual(expected);
});

it.each([
  { name: "required undefined", schema: { type: "object", properties: { value: { type: "number", multipleOf: 3 } }, required: ["value"] }, input: { value: undefined } },
  { name: "unknown undefined", schema: { type: "object", properties: { value: { type: "number", multipleOf: 3 } } }, input: { unknown: undefined } },
  { name: "array undefined", schema: { type: "object", properties: { values: { type: "array", items: { type: "number" } } } }, input: { values: [undefined] } },
])("rejects native $name before executing the SDK handler", async ({ schema, input }) => {
  const params = convertJsonSchema(schema as Parameters<typeof convertJsonSchema>[0]);
  if (params.kind !== "object") throw new Error("Expected object projection");
  const handler = vi.fn(() => "accepted");
  const root = defineGroup({ name: "audit", children: [defineCommand({ name: "value", params, handler })] });
  await expect(createSDK(root, { errorReports: false }).value(input)).rejects.toThrow();
  expect(handler).not.toHaveBeenCalled();
});

it.each(["accessor", "serialization hook"])("does not execute native SDK %s while omitting optional undefined", async (kind) => {
  const params = convertJsonSchema({ type: "object", properties: { value: { type: "number", multipleOf: 3 } } });
  if (params.kind !== "object") throw new Error("Expected object projection");
  const hook = vi.fn(() => 3);
  const input = kind === "accessor"
    ? Object.defineProperty({}, "value", { enumerable: true, get: hook })
    : Object.defineProperty({ value: undefined }, "toJSON", { value: hook });
  const handler = vi.fn(() => "accepted");
  const root = defineGroup({ name: "audit", children: [defineCommand({ name: "value", params, handler })] });
  await expect(createSDK(root, { errorReports: false }).value(input)).rejects.toThrow();
  expect(hook).not.toHaveBeenCalled();
  expect(handler).not.toHaveBeenCalled();
});

it.each(["a", "b"])("accepts native composition branch %s through CLI and MCP", async (mode) => {
  const params = convertJsonSchema({ type: "object", oneOf: [
    { type: "object", properties: { mode: { const: "a" }, a: { type: "number", default: 1 } }, required: ["mode"], additionalProperties: false },
    { type: "object", properties: { mode: { const: "b" }, b: { type: "number", default: 2 } }, required: ["mode"], additionalProperties: false }
  ] });
  if (params.kind !== "object") throw new Error("Expected object projection");
  const handler = vi.fn(({ params }) => params);
  const root = defineGroup({ name: "audit", children: [defineCommand({ name: "value", scope: ["cli", "sdk", "mcp"], params, handler })] });
  const previousExitCode = process.exitCode;
  const session = createMCPServer(root, { name: "audit", version: "1", errorReports: false }).createMessageSession();
  try {
    process.exitCode = 0;
    await runCLI(root, { argv: ["node", "audit", "value", "--mode", mode], errorReports: false, outputEmitter: () => {} });
    expect(process.exitCode).toBe(0);
    const _meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };
    expect(await session.handleMessage("tools/call", { name: "audit__value", arguments: { mode }, _meta })).toHaveProperty("result");
    expect(handler).toHaveBeenCalledTimes(2);
  } finally { process.exitCode = previousExitCode; session.close(); }
});

it("rejects inherited array serialization hooks during native optional normalization", async () => {
  const params = convertJsonSchema({ type: "object", properties: { values: { type: "array", items: { type: "number" } } } });
  if (params.kind !== "object") throw new Error("Expected object projection");
  const hook = vi.fn(() => [9]);
  const values = [3];
  Object.setPrototypeOf(values, Object.create(Array.prototype, { toJSON: { value: hook } }));
  const handler = vi.fn(() => "accepted");
  const root = defineGroup({ name: "audit", children: [defineCommand({ name: "value", params, handler })] });
  await expect(createSDK(root, { errorReports: false }).value({ values })).rejects.toThrow();
  expect(hook).not.toHaveBeenCalled();
  expect(handler).not.toHaveBeenCalled();
});
