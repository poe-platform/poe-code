import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S, type AnySchema } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";

const previousExitCode = process.exitCode;
beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = previousExitCode; });

const scenarios = [
  { name: "number", schema: S.Number(), invalid: "oops", valid: "2", expected: 2 },
  { name: "integer", schema: S.Number({ jsonType: "integer" }), invalid: "1.5", valid: "2", expected: 2 },
  { name: "boolean", schema: S.Boolean(), invalid: "oops", valid: "false", expected: false },
  { name: "enum", schema: S.Enum(["ready", "stopped"]), invalid: "reed", valid: "ready", expected: "ready" },
  { name: "JSON", schema: S.Json(), invalid: "[invalid", valid: '{"ready":true}', expected: { ready: true } },
  { name: "string constraint", schema: S.String({ minLength: 2 }), invalid: "x", valid: "ready", expected: "ready" }
];

type Route = "flag" | "nested flag" | "dynamic record" | "positional" | "array flag" | "array positional";

async function invoke(route: Route, schema: AnySchema, input: string) {
  const array = route === "array flag" || route === "array positional";
  const field = array ? S.Array(schema) : schema;
  const nested = route === "nested flag" || route === "dynamic record";
  const params = route === "nested flag"
    ? S.Object({ values: S.Object({ entry: field }) })
    : route === "dynamic record" ? S.Object({ values: S.Record(field) }) : S.Object({ value: field });
  const positional = route === "positional" || route === "array positional";
  const label = nested ? "values.entry" : "value";
  const output: string[] = [];
  const handler = vi.fn(({ params }: { params: unknown }) => params);
  const root = defineGroup({ name: "audit", children: [defineGroup({ name: "inspect", children: [defineCommand({
    name: "check", params, positional: positional ? ["value"] : [], handler
  })] })] });

  await runCLI(root, {
    argv: ["node", "audit", "inspect", "check", "--yes", ...(positional ? ["--", input] : [`--${label}=${input}`])],
    controls: { yes: true }, approvals: false, errorReports: false,
    outputEmitter: (entry) => output.push(entry)
  });

  return { output, handler, label };
}

describe.each(["flag", "nested flag", "dynamic record", "positional"] as const)("%s validation presentation", (route) => {
  describe.each(scenarios)("$name", ({ schema, invalid, valid, expected }) => {
    it.each([invalid, ""])("prints a value error without a Commander prefix for %j", async (input) => {
      const { output, handler, label } = await invoke(route, schema, input);
      const message = output.join("\n");

      expect(process.exitCode).toBe(1);
      expect(handler).not.toHaveBeenCalled();
      expect(message.startsWith(`Invalid value for "${label}".`)).toBe(true);
      expect(message.endsWith("Run audit inspect check --help for usage.")).toBe(true);
      expect(message.split("Run audit inspect check --help for usage.")).toHaveLength(2);
    });

    it("preserves valid handler inputs", async () => {
      const { handler } = await invoke(route, schema, valid);

      expect(process.exitCode).toBe(0);
      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]?.[0].params).toEqual(route === "nested flag" || route === "dynamic record"
        ? { values: { entry: expected } }
        : { value: expected });
    });
  });
});

describe.each(["array flag", "array positional"] as const)("%s item validation presentation", (route) => {
  it.each(scenarios.filter((scenario) => scenario.schema.kind !== "json"))("normalizes invalid $name items", async ({ schema, invalid }) => {
    const { output, handler } = await invoke(route, schema, invalid);

    expect(process.exitCode).toBe(1);
    expect(handler).not.toHaveBeenCalled();
    expect(output.join("\n").startsWith('Invalid value for "value".')).toBe(true);
    expect(output.join("\n").endsWith("Run audit inspect check --help for usage.")).toBe(true);
  });
});

describe("Commander syntax-error presentation controls", () => {
  it.each([
    { name: "missing flag argument", params: S.Object({ value: S.Number() }), args: ["--value"], expected: "error: option '--value <value>' argument missing" },
    { name: "missing dynamic argument", params: S.Object({ weights: S.Record(S.Number()) }), args: ["--weights.entry"], expected: "error: option 'weights.entry' argument missing" },
    { name: "invalid output control", params: S.Object({}), args: ["--output=oops"], expected: "error: option '--output <format>' argument 'oops' is invalid." },
    { name: "invalid debug control", params: S.Object({}), args: ["--debug=oops"], expected: "error: option '--debug [mode]' argument 'oops' is invalid." },
    { name: "invalid log control", params: S.Object({}), args: ["--log-level=oops"], expected: "error: option '--log-level <level>' argument 'oops' is invalid." },
    { name: "unknown option", params: S.Object({}), args: ["--mystery"], expected: 'Unknown option "--mystery".' }
  ])("preserves $name", async ({ params, args, expected }) => {
    const output: string[] = [];
    const handler = vi.fn();
    const root = defineGroup({ name: "audit", children: [defineGroup({ name: "inspect", children: [defineCommand({ name: "check", params, handler })] })] });

    await runCLI(root, {
      argv: ["node", "audit", "inspect", "check", "--yes", ...args],
      controls: { yes: true, output: true, debug: true, logLevel: true },
      approvals: false, errorReports: false, outputEmitter: (entry) => output.push(entry)
    });

    expect(process.exitCode).toBe(1);
    expect(handler).not.toHaveBeenCalled();
    expect(output.join("\n").startsWith(expected)).toBe(true);
    expect(output.join("\n").endsWith("Run audit inspect check --help for usage.")).toBe(true);
  });
});
