import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S, type ObjectSchema } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";

const previousExitCode = process.exitCode;
beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = previousExitCode; });

async function invoke(route: string, params: ObjectSchema<any>, args: string[]) {
  const handler = vi.fn(({ params }: { params: unknown }) => params);
  const command = defineCommand({ name: "check", aliases: ["inspect"], params, positional: ["target"], handler });
  const nested = route === "nested" || route === "nested default";
  const group = defineGroup({ name: "group", children: [command], ...(route === "nested default" ? { default: command } : {}) });
  const root = defineGroup({ name: "audit", children: [nested ? group : command], ...(route === "default" ? { default: command } : {}) });
  const path = [...(nested ? ["group"] : []), ...(["default", "nested default"].includes(route) ? [] : [route === "alias" ? "inspect" : "check"])];
  const output: string[] = [];
  process.exitCode = 0;
  await runCLI(root, { argv: ["node", "audit", ...path, "--yes", ...args], controls: { yes: true }, errorReports: false, outputEmitter: (entry) => output.push(entry) });
  return { handler, output };
}

describe.each(["direct", "nested", "alias", "default", "nested default"])("shorthand operands via %s", (route) => {
  describe.each([false, true])("dynamic sibling=%s", (dynamic) => {
    describe.each([
      { name: "string", numeric: false, array: false },
      { name: "number", numeric: true, array: false },
      { name: "string array", numeric: false, array: true },
      { name: "number array", numeric: true, array: true }
    ])("$name positional", ({ numeric, array }) => {
      const scalar = numeric ? S.Number() : S.String();
      const params = S.Object({ target: array ? S.Array(scalar) : scalar, ...(dynamic ? { labels: S.Optional(S.Record(S.String())) } : {}) });
      it.each(["-x", "-xyz", "-x=value", "-y3"])("rejects undeclared %s", async (token) => {
        const { handler, output } = await invoke(route, params, [token]);
        expect(process.exitCode).toBe(1);
        expect(handler).not.toHaveBeenCalled();
        expect(output.join("\n")).toContain(`Unknown option "${token}"`);
      });

      it.each(["-3", "-.5", "-1e3", "-"])("preserves numeric/literal operand %s", async (token) => {
        const { handler, output } = await invoke(route, params, [token]);
        if (numeric && token === "-") {
          expect(process.exitCode).toBe(1);
          expect(handler).not.toHaveBeenCalled();
          expect(output.join("\n")).not.toContain("Unknown option");
        } else {
          const value = numeric ? Number(token) : token;
          expect(process.exitCode, output.join("\n")).toBe(0);
          expect(handler).toHaveBeenCalledOnce();
          expect(handler.mock.calls[0]![0].params).toEqual({ target: array ? [value] : value });
        }
      });

      it("honors explicit end-of-options", async () => {
        const { handler, output } = await invoke(route, params, ["--", "-x"]);
        expect(output.join("\n")).not.toContain("Unknown option");
        expect(process.exitCode).toBe(numeric ? 1 : 0);
        if (numeric) expect(handler).not.toHaveBeenCalled();
        else expect(handler.mock.calls[0]![0].params).toEqual({ target: array ? ["-x"] : "-x" });
      });
    });

    it.each([
      { name: "literal suffix after a negative prefix", args: ["-3", "--", "-x"], expected: { target: ["-3", "-x"] } },
      { name: "ordinary suffix after a negative prefix", args: ["-3", "word"], expected: { target: ["-3", "word"] } },
      { name: "comma token as one string operand", args: ["-1,-2"], expected: { target: ["-1,-2"] } },
      { name: "known option after a negative prefix", args: ["-3", "--text", "-x", "word"], expected: { target: ["-3", "word"], text: "-x" } },
      { name: "scalar option before a negative operand", args: ["--text", "-x", "-3"], expected: { target: ["-3"], text: "-x" } },
      { name: "separator as a required scalar value", args: ["--text", "--", "-3"], expected: { target: ["-3"], text: "--" } },
      { name: "unknown shorthand after a numeric prefix", args: ["-3", "-x"] },
      { name: "unknown long flag after a numeric prefix", args: ["-3", "--unknown"] }
    ])("preserves $name", async ({ args, expected }) => {
      const params = S.Object({ target: S.Array(S.String()), text: S.Optional(S.String()), ...(dynamic ? { labels: S.Optional(S.Record(S.String())) } : {}) });
      const { handler, output } = await invoke(route, params, args);
      if (expected === undefined) {
        expect(process.exitCode).toBe(1);
        expect(handler).not.toHaveBeenCalled();
      } else {
        expect(process.exitCode, output.join("\n")).toBe(0);
        expect(handler.mock.calls[0]![0].params).toEqual(expected);
      }
    });
  });

  it.each([
    { name: "dynamic value before numeric operand", args: ["--labels.env", "-x", "-3"], expected: { labels: { env: "-x" }, target: [-3] } },
    { name: "dynamic value after numeric operand", args: ["-3", "--labels.env", "-x"], expected: { labels: { env: "-x" }, target: [-3] } },
    { name: "multiple numbers before dynamic value", args: ["-1", "-2", "--labels.env", "-x"], expected: { labels: { env: "-x" }, target: [-1, -2] } }
  ])("preserves $name ownership", async ({ args, expected }) => {
    const { handler, output } = await invoke(route, S.Object({ target: S.Array(S.Number()), labels: S.Record(S.String()) }), args);
    expect(process.exitCode, output.join("\n")).toBe(0);
    expect(handler.mock.calls[0]![0].params).toEqual(expected);
  });
});
