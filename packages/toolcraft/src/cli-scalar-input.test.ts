import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";

const previousExitCode = process.exitCode;
beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = previousExitCode; });

const number = S.Number();
const routes = [
  { name: "separate flag", params: S.Object({ count: number }), positional: [], args: (value: string) => ["--count", value], expected: (value: number) => ({ count: value }) },
  { name: "inline flag", params: S.Object({ count: number }), positional: [], args: (value: string) => [`--count=${value}`], expected: (value: number) => ({ count: value }) },
  { name: "nested flag", params: S.Object({ settings: S.Object({ count: number }) }), positional: [], args: (value: string) => ["--settings.count", value], expected: (value: number) => ({ settings: { count: value } }) },
  { name: "dynamic record flag", params: S.Object({ weights: S.Record(number) }), positional: [], args: (value: string) => ["--weights.count", value], expected: (value: number) => ({ weights: { count: value } }) },
  { name: "inline dynamic flag", params: S.Object({ weights: S.Record(number) }), positional: [], args: (value: string) => [`--weights.count=${value}`], expected: (value: number) => ({ weights: { count: value } }) },
  { name: "positional", params: S.Object({ count: number }), positional: ["count"], args: (value: string) => ["--", value], expected: (value: number) => ({ count: value }) },
  { name: "defaulted positional", params: S.Object({ count: S.Number({ default: 7 }) }), positional: ["count"], args: (value: string) => ["--", value], expected: (value: number) => ({ count: value }) },
  { name: "variadic positional", params: S.Object({ counts: S.Array(number) }), positional: ["counts"], args: (value: string) => ["--", value], expected: (value: number) => ({ counts: [value] }) }
];

describe.each(routes)("numeric CLI $name", (route) => {
  it.each(["", " ", "\t", "\n", "\u00a0", "0", " 2 ", "-3", "1.5", "1e2", "0x10", "not-a-number", "Infinity"])("validates the explicit token %j", async (input) => {
    const handler = vi.fn((context: { params: unknown }) => context.params);
    const output: string[] = [];
    const command = defineCommand({ name: "check", scope: ["cli"], params: route.params, positional: route.positional, handler });
    await runCLI(defineGroup({ name: "audit", children: [command] }), { argv: ["node", "audit", "check", "--yes", ...route.args(input)], errorReports: false, controls: { yes: true }, outputEmitter: (entry) => output.push(entry) });
    const valid = input.trim().length > 0 && Number.isFinite(Number(input));
    if (valid) {
      expect(process.exitCode).toBe(0);
      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]?.[0]).toMatchObject({ params: route.expected(Number(input)) });
    } else {
      expect(process.exitCode).toBe(1);
      expect(handler).not.toHaveBeenCalled();
      expect(output.join("\n")).toContain("count");
    }
  });
});

describe("explicit empty scalar positionals", () => {
  it.each(["required", "optional", "defaulted"])("preserves an empty %s string instead of treating it as missing", async (kind) => {
    const schema = kind === "optional" ? S.Optional(S.String()) : S.String(kind === "defaulted" ? { default: "seed" } : {});
    const handler = vi.fn((context: { params: unknown }) => context.params);
    const command = defineCommand({ name: "check", scope: ["cli"], positional: ["value"], params: S.Object({ value: schema }), handler });
    await runCLI(defineGroup({ name: "audit", children: [command] }), { argv: ["node", "audit", "check", "--yes", ""], errorReports: false, controls: { yes: true }, outputEmitter: () => {} });
    expect(process.exitCode).toBe(0);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ params: { value: "" } });
  });

  it("accepts a declared empty enum value", async () => {
    const handler = vi.fn((context: { params: unknown }) => context.params);
    const command = defineCommand({ name: "check", scope: ["cli"], positional: ["value"], params: S.Object({ value: S.Enum(["", "seed"]) }), handler });
    await runCLI(defineGroup({ name: "audit", children: [command] }), { argv: ["node", "audit", "check", "--yes", ""], errorReports: false, controls: { yes: true }, outputEmitter: () => {} });
    expect(process.exitCode).toBe(0);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ params: { value: "" } });
  });

  it.each([S.String({ minLength: 1, default: "seed" }), S.Boolean({ default: true })])("validates an empty token rather than substituting its schema default", async (schema) => {
    const handler = vi.fn((context: { params: unknown }) => context.params);
    const command = defineCommand({ name: "check", scope: ["cli"], positional: ["value"], params: S.Object({ value: schema }), handler });
    await runCLI(defineGroup({ name: "audit", children: [command] }), { argv: ["node", "audit", "check", "--yes", ""], errorReports: false, controls: { yes: true }, outputEmitter: () => {} });
    expect(process.exitCode).toBe(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("still applies defaults when the positional is genuinely absent", async () => {
    const handler = vi.fn((context: { params: unknown }) => context.params);
    const command = defineCommand({ name: "check", scope: ["cli"], positional: ["value"], params: S.Object({ value: S.String({ default: "seed" }) }), handler });
    await runCLI(defineGroup({ name: "audit", children: [command] }), { argv: ["node", "audit", "check", "--yes"], errorReports: false, controls: { yes: true }, outputEmitter: () => {} });
    expect(process.exitCode).toBe(0);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ params: { value: "seed" } });
  });
});

describe("numeric CLI compatibility controls", () => {
  it.each(["", " ", "1, 2"])("retains numeric array flag parsing for %j", async (input) => {
    const handler = vi.fn((context: { params: unknown }) => context.params);
    const command = defineCommand({ name: "check", scope: ["cli"], params: S.Object({ counts: S.Array(S.Number()) }), handler });
    await runCLI(defineGroup({ name: "audit", children: [command] }), { argv: ["node", "audit", "check", "--counts", input], errorReports: false, outputEmitter: () => {} });
    expect(process.exitCode).toBe(0);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ params: { counts: input.trim() === "" ? [] : [1, 2] } });
  });

  it.each([
    { schema: S.Number({ nullable: true }), value: "null", valid: true, expected: null },
    { schema: S.Number({ jsonType: "integer" }), value: "1.5", valid: false },
    { schema: S.Number({ minimum: 1 }), value: "0", valid: false },
    { schema: S.Number({ maximum: 2 }), value: "3", valid: false }
  ])("retains scalar number constraints for $value", async ({ schema, value, valid, expected }) => {
    const handler = vi.fn((context: { params: unknown }) => context.params);
    const command = defineCommand({ name: "check", scope: ["cli"], params: S.Object({ count: schema }), handler });
    await runCLI(defineGroup({ name: "audit", children: [command] }), { argv: ["node", "audit", "check", "--count", value], errorReports: false, outputEmitter: () => {} });
    expect(process.exitCode).toBe(valid ? 0 : 1);
    if (valid) expect(handler.mock.calls[0]?.[0]).toMatchObject({ params: { count: expected } });
    else expect(handler).not.toHaveBeenCalled();
  });
});
