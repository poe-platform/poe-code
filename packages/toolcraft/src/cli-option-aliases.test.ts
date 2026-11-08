import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S, type AnySchema } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";

const previousExitCode = process.exitCode;
beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = previousExitCode; });

const configurations = [
  { name: "single alias", options: { cliAliases: ["alternate"] } },
  { name: "short and alias", options: { short: "v", cliAliases: ["alternate"] } },
  { name: "multiple aliases", options: { cliAliases: ["alternate", "another"] } },
  { name: "short and multiple aliases", options: { short: "v", cliAliases: ["alternate", "another"] } }
];

async function invoke(route: string, schema: AnySchema, args: string[]) {
  const handler = vi.fn(({ params }: { params: unknown }) => params);
  const command = defineCommand({ name: "check", aliases: ["inspect"], params: S.Object({ value: schema }), handler });
  const nested = route === "nested" || route === "nested default";
  const group = defineGroup({ name: "group", children: [command], ...(route === "nested default" ? { default: command } : {}) });
  const root = defineGroup({ name: "audit", children: [nested ? group : command], ...(route === "default" ? { default: command } : {}) });
  const path = [...(nested ? ["group"] : []), ...(["default", "nested default"].includes(route) ? [] : [route === "alias" ? "inspect" : "check"])];
  const output: string[] = [];
  process.exitCode = 0;
  const helpOutput = args.includes("--help") ? vi.spyOn(process.stdout, "write").mockImplementation((entry) => { output.push(String(entry)); return true; }) : undefined;
  try {
    await runCLI(root, { argv: ["node", "audit", ...path, "--yes", ...args], controls: { yes: true }, errorReports: false, outputEmitter: (entry) => output.push(entry) });
  } finally {
    helpOutput?.mockRestore();
  }
  return { handler, output };
}

describe.each(["direct", "nested", "alias", "default", "nested default"])("option aliases via %s", (route) => {
  describe.each(configurations)("$name", ({ options }) => {
    const flags = ["--value", ...options.cliAliases.map((alias) => `--${alias}`), ...(options.short ? [`-${options.short}`] : [])];
    it.each(flags)("binds numeric %s", async (flag) => {
      const { handler, output } = await invoke(route, S.Number(options), [flag, "7"]);
      expect(process.exitCode, output.join("\n")).toBe(0);
      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]![0].params).toEqual({ value: 7 });
    });

    it.each(flags)("accumulates negative numeric arrays through %s", async (flag) => {
      const { handler, output } = await invoke(route, S.Array(S.Number(), options), ["--value", "1", flag, "-2", "-3"]);
      expect(process.exitCode, output.join("\n")).toBe(0);
      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]![0].params).toEqual({ value: [1, -2, -3] });
    });

    it.each(flags)("binds implicit and explicit booleans through %s", async (flag) => {
      for (const values of [[], ["false"]]) {
        const { handler, output } = await invoke(route, S.Boolean(options), [flag, ...values]);
        expect(process.exitCode, output.join("\n")).toBe(0);
        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0]![0].params).toEqual({ value: values.length === 0 });
      }
    });

    it("preserves last-value precedence across spellings", async () => {
      const { handler, output } = await invoke(route, S.String(options), ["--value", "first", "--alternate", "second", "--value", "last"]);
      expect(process.exitCode, output.join("\n")).toBe(0);
      expect(handler.mock.calls[0]![0].params).toEqual({ value: "last" });
    });

    it("preserves canonical boolean negation after an alias", async () => {
      const { handler, output } = await invoke(route, S.Boolean(options), ["--alternate", "--no-value"]);
      expect(process.exitCode, output.join("\n")).toBe(0);
      expect(handler.mock.calls[0]![0].params).toEqual({ value: false });
    });

    it("leaves an omitted optional boolean absent", async () => {
      const { handler, output } = await invoke(route, S.Optional(S.Boolean(options)), []);
      expect(process.exitCode, output.join("\n")).toBe(0);
      expect(handler.mock.calls[0]![0].params).toEqual({});
    });

    it("preserves a default without making an alias independently required", async () => {
      const { handler, output } = await invoke(route, S.Number({ ...options, default: 5 }), []);
      expect(process.exitCode, output.join("\n")).toBe(0);
      expect(handler.mock.calls[0]![0].params).toEqual({ value: 5 });
    });

    it("parses JSON through an alias into the canonical field", async () => {
      const { handler, output } = await invoke(route, { ...S.Json(), ...options }, ["--alternate", '{"ready":true}']);
      expect(process.exitCode, output.join("\n")).toBe(0);
      expect(handler.mock.calls[0]![0].params).toEqual({ value: { ready: true } });
    });

    it("renders every spelling in command help", async () => {
      const { handler, output } = await invoke(route, S.Number(options), ["--help"]);
      expect(process.exitCode, output.join("\n")).toBe(0);
      expect(handler).not.toHaveBeenCalled();
      for (const flag of flags) expect(output.join("\n")).toContain(flag);
    });
  });
});
