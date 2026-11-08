import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S, type ObjectSchema } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";

const previousExitCode = process.exitCode;
beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = previousExitCode; vi.restoreAllMocks(); });

async function invoke(route: string, params: ObjectSchema<any>, args: string[], positional = false) {
  const handler = vi.fn(({ params }: { params: unknown }) => params);
  const command = defineCommand({ name: "check", aliases: ["inspect"], params, ...(positional ? { positional: ["target"] } : {}), handler, render: { markdown: () => "markdown-owner" } });
  const nested = route === "nested" || route === "nested default";
  const group = defineGroup({ name: "group", children: [command], ...(route === "nested default" ? { default: command } : {}) });
  const root = defineGroup({ name: "audit", children: [nested ? group : command], ...(route === "default" ? { default: command } : {}) });
  const path = [...(nested ? ["group"] : []), ...(["default", "nested default"].includes(route) ? [] : [route === "alias" ? "inspect" : "check"])];
  const output: string[] = [];
  let stdout = "";
  vi.spyOn(process.stdout, "write").mockImplementation((entry) => { stdout += String(entry); return true; });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  await runCLI(root, {
    argv: ["node", "audit", "--yes", "--output", "json", ...path, ...args],
    controls: { yes: true, output: true, verbose: true, debug: true, logLevel: true },
    version: "1.2.3",
    errorReports: false,
    outputEmitter: (entry) => output.push(entry)
  });
  return { handler, output, stdout };
}

describe.each(["direct", "nested", "alias", "default", "nested default"])("CLI control ownership via %s", (route) => {
  describe.each(["-v", "--verbose", "-h", "--help"])("data token=%s", (value) => {
    it.each(["string", "array", "record"])("preserves a declared %s option value", async (kind) => {
      const schema = kind === "array" ? S.Array(S.String()) : kind === "record" ? S.Record(S.String()) : S.String({ short: "t", cliAliases: ["value"] });
      const flag = kind === "record" ? "--target.entry" : "--target";
      const result = await invoke(route, S.Object({ target: schema }), [flag, value]);
      expect(process.exitCode, result.output.join("\n")).toBe(0);
      expect(result.handler).toHaveBeenCalledOnce();
      expect(result.handler.mock.calls[0]![0].params).toEqual({ target: kind === "array" ? [value] : kind === "record" ? { entry: value } : value });
      expect(result.stdout).toBe("");
    });

    it("preserves a positional after the literal separator", async () => {
      const result = await invoke(route, S.Object({ target: S.String() }), ["--", value], true);
      expect(process.exitCode, result.output.join("\n")).toBe(0);
      expect(result.handler).toHaveBeenCalledOnce();
      expect(result.handler.mock.calls[0]![0].params).toEqual({ target: value });
      expect(result.stdout).toBe("");
    });

    it.each(["inline", "attached", "alias", "short"])("preserves the %s string spelling", async (spelling) => {
      const args = spelling === "inline" ? [`--target=${value}`] : spelling === "attached" ? [`-t${value}`] : [spelling === "short" ? "-t" : "--value", value];
      const result = await invoke(route, S.Object({ target: S.String({ short: "t", cliAliases: ["value"] }) }), args);
      expect(process.exitCode, result.output.join("\n")).toBe(0);
      expect(result.handler).toHaveBeenCalledOnce();
      expect(result.handler.mock.calls[0]![0].params).toEqual({ target: value });
    });
  });

  it.each(["-h", "--help"])("retains actual help control %s", async (flag) => {
    const result = await invoke(route, S.Object({ target: S.String() }), [flag]);
    expect(process.exitCode, result.output.join("\n")).toBe(0);
    expect(result.handler).not.toHaveBeenCalled();
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it.each(["-v", "--verbose"])("retains actual verbose control %s", async (flag) => {
    const result = await invoke(route, S.Object({ target: S.String() }), [flag, "--target", "ordinary"]);
    expect(process.exitCode, result.output.join("\n")).toBe(0);
    expect(result.handler).toHaveBeenCalledOnce();
    expect(result.handler.mock.calls[0]![0].params).toEqual({ target: "ordinary" });
  });

  describe.each(["--yes", "--debug", "--output", "--log-level", "--version", "--preset"])("other data token=%s", (value) => {
    it.each(["string", "record"])("preserves a %s option value", async (kind) => {
      const schema = kind === "record" ? S.Record(S.String()) : S.String();
      const flag = kind === "record" ? "--target.entry" : "--target";
      const result = await invoke(route, S.Object({ target: schema }), [flag, value]);
      expect(process.exitCode, result.output.join("\n")).toBe(0);
      expect(result.handler).toHaveBeenCalledOnce();
      expect(result.handler.mock.calls[0]![0].params).toEqual({ target: kind === "record" ? { entry: value } : value });
      expect(result.stdout).toBe("");
    });
  });

  it("retains the version control after the command", async () => {
    const result = await invoke(route, S.Object({ target: S.String() }), ["--version"]);
    expect(process.exitCode, result.output.join("\n")).toBe(0);
    expect(result.handler).not.toHaveBeenCalled();
    expect(result.stdout.trim()).toBe("1.2.3");
  });

  it("lets a later output control override an ancestor value", async () => {
    const result = await invoke(route, S.Object({ target: S.String() }), ["--target", "ordinary", "--output", "md"]);
    expect(process.exitCode, result.output.join("\n")).toBe(0);
    expect(result.handler).toHaveBeenCalledOnce();
    expect(result.output.join("\n")).toContain("markdown-owner");
  });

  it("does not interpret an output-control-shaped string value as help formatting", async () => {
    const result = await invoke(route, S.Object({ target: S.String() }), ["--target", "--output", "--help"]);
    expect(process.exitCode, result.output.join("\n")).toBe(0);
    expect(result.handler).not.toHaveBeenCalled();
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it.each(["-v", "--help", "--", "--target.entry"])("retains a required value after a short-option cluster: %s", async (value) => {
    const params = S.Object({ verbose: S.Optional(S.Boolean({ short: "v", global: true })), target: S.String({ short: "t" }), labels: S.Optional(S.Record(S.String())) });
    const result = await invoke(route, params, ["-vt", value]);
    expect(process.exitCode, result.output.join("\n")).toBe(0);
    expect(result.handler).toHaveBeenCalledOnce();
    expect(result.handler.mock.calls[0]![0].params).toEqual({ verbose: true, target: value });
    expect(result.stdout).toBe("");
  });

  it.each(["--", "-t", "--labels.entry"])("retains a dynamic scalar value %s without parsing it again", async (value) => {
    const params = S.Object({ target: S.Record(S.String()), other: S.Optional(S.String({ short: "t" })), labels: S.Optional(S.Record(S.String())) });
    const result = await invoke(route, params, ["--target.entry", value]);
    expect(process.exitCode, result.output.join("\n")).toBe(0);
    expect(result.handler).toHaveBeenCalledOnce();
    expect(result.handler.mock.calls[0]![0].params).toEqual({ target: { entry: value } });
    expect(result.stdout).toBe("");
  });
});

describe.each([false, true])("hidden default help nested=%s", (nested) => {
  it.each(["", "fallback"])("does not expose the internal name for %j", async (name) => {
    const handler = vi.fn();
    const command = defineCommand({ name, hidden: true, params: S.Object({}), handler });
    const group = defineGroup({ name: "group", children: [command], default: command });
    const root = nested ? defineGroup({ name: "audit", children: [group] }) : defineGroup({ name: "audit", children: [command], default: command });
    const output: string[] = [];
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCLI(root, {
      argv: ["node", "audit", ...(nested ? ["group"] : []), "__toolcraft_default__", "--help"],
      errorReports: false,
      outputEmitter: (entry) => output.push(entry)
    });

    expect(process.exitCode).toBe(1);
    expect(handler).not.toHaveBeenCalled();
    expect(output.join("\n")).toContain('Unknown command "__toolcraft_default__"');
    expect(stdout).not.toHaveBeenCalled();
  });
});
