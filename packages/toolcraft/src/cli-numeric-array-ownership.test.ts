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

describe.each(["direct", "nested", "alias", "default", "nested default"])("numeric array ownership via %s", (route) => {
  describe.each([
    { name: "minimum", schema: S.Number({ minimum: 0 }), value: "-2" },
    { name: "integer", schema: S.Number({ jsonType: "integer" }), value: "-2.5" }
  ])("dynamic array $name", ({ schema, value }) => {
    it.each([
      { name: "first element", prefix: [] },
      { name: "later element", prefix: ["1"] },
      { name: "comma element", prefix: [], comma: true }
    ])("validates an invalid negative $name before positional binding", async ({ prefix, comma }) => {
      const params = S.Object({ numbers: S.Record(S.Array(schema)), target: S.Number() });
      const { handler, output } = await invoke(route, params, ["--numbers.sample", ...prefix, comma ? `1,${value}` : value]);
      expect(process.exitCode).toBe(1);
      expect(handler).not.toHaveBeenCalled();
      expect(output.join("\n")).toContain('Invalid value for "numbers.sample"');
    });
  });

  describe.each([false, true])("dynamic fields=%s", (dynamic) => {
    describe.each(["long", "short", "alias"])("%s array flag", (flagKind) => {
      it.each([
        { name: "positive", tokens: ["1", "2"], numbers: [1, 2] },
        { name: "negative", tokens: ["-1", "-2"], numbers: [-1, -2] },
        { name: "mixed signs", tokens: ["1", "-2", "3", "-4"], numbers: [1, -2, 3, -4] },
        { name: "commas", tokens: ["-1,-2", "-3"], numbers: [-1, -2, -3] },
        { name: "decimal and exponent", tokens: ["-.5", "-1e2"], numbers: [-0.5, -100] }
      ])("keeps $name values out of the positional slot", async ({ tokens, numbers }) => {
        const arrayOptions = flagKind === "short" ? { short: "n" } : flagKind === "alias" ? { cliAliases: ["values"] } : {};
        const flag = flagKind === "short" ? "-n" : flagKind === "alias" ? "--values" : "--numbers";
        const params = S.Object({ numbers: S.Array(S.Number(), arrayOptions), target: S.Number(), ...(dynamic ? { labels: S.Optional(S.Record(S.String())) } : {}) });
        for (const supplied of [false, true]) {
          const { handler, output } = await invoke(route, params, [flag, ...tokens, ...(supplied ? ["--", "7"] : [])]);
          if (supplied) {
            expect(process.exitCode, output.join("\n")).toBe(0);
            expect(handler).toHaveBeenCalledOnce();
            expect(handler.mock.calls[0]![0].params).toEqual({ numbers, target: 7 });
          } else {
            expect(process.exitCode).toBe(1);
            expect(handler).not.toHaveBeenCalled();
            expect(output.join("\n")).toContain('Missing required parameter "target"');
          }
        }
      });
    });

    it.each([
      { name: "inline comma array", args: ["--numbers=-1,-2", "--", "7"], expected: { numbers: [-1, -2], target: 7 } },
      { name: "inline value boundary", args: ["--numbers=-1", "7"], expected: { numbers: [-1], target: 7 } },
      { name: "attached short value boundary", args: ["-n-1", "7"], expected: { numbers: [-1], target: 7 } },
      { name: "array flag inside another option value", args: ["--numbers=1", "--text", "--numbers", "--", "-2"], expected: { numbers: [1], text: "--numbers", target: -2 } },
      { name: "short array flag inside another option value", args: ["--numbers=1", "-t", "-n", "--", "-2"], expected: { numbers: [1], text: "-n", target: -2 } },
      { name: "following scalar option", args: ["--numbers", "1", "--text", "-2", "--", "7"], expected: { numbers: [1], text: "-2", target: 7 } },
      { name: "separator consumed as a required option value", args: ["--text", "--", "--numbers", "1", "-2", "--", "7"], expected: { text: "--", numbers: [1, -2], target: 7 } },
      { name: "attached scalar option", args: ["-t--numbers", "--numbers", "1", "-2", "--", "7"], expected: { text: "--numbers", numbers: [1, -2], target: 7 } },
      { name: "repeated array option", args: ["--numbers", "1", "-2", "--numbers", "3", "-4", "--", "7"], expected: { numbers: [1, -2, 3, -4], target: 7 } },
      { name: "short repeated array option", args: ["-n", "1", "-2", "-n", "3", "-4", "--", "7"], expected: { numbers: [1, -2, 3, -4], target: 7 } },
      { name: "negative literal target", args: ["--numbers", "1", "-2", "--", "-7"], expected: { numbers: [1, -2], target: -7 } },
      { name: "optional boolean before array", args: ["--toggle", "--numbers", "1", "-2", "--", "7"], expected: { toggle: true, numbers: [1, -2], target: 7 } },
      { name: "optional boolean value before array", args: ["--toggle", "false", "--numbers", "1", "-2", "--", "7"], expected: { toggle: false, numbers: [1, -2], target: 7 } },
      { name: "declared numeric short flag", args: ["--numbers", "1", "-2", "--", "7"], numericShort: true, expected: { numbers: [1], toggle: true, target: 7 } },
      { name: "attached numeric short flag", args: ["--numbers", "1", "-21", "--", "7"], numericShort: true }
    ])("preserves $name", async ({ args, expected, numericShort }) => {
      const params = S.Object({ numbers: S.Array(S.Number(), { short: "n" }), target: S.Number(), text: S.Optional(S.String({ short: "t" })), toggle: S.Optional(S.Boolean(numericShort ? { short: "2" } : {})), ...(dynamic ? { labels: S.Optional(S.Record(S.String())) } : {}) });
      const { handler, output } = await invoke(route, params, args);
      if (expected === undefined) {
        expect(process.exitCode).toBe(1);
        expect(handler).not.toHaveBeenCalled();
      } else {
        expect(process.exitCode, output.join("\n")).toBe(0);
        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0]![0].params).toEqual(expected);
      }
    });

    it.each([
      { name: "minimum", schema: S.Number({ minimum: 0 }) },
      { name: "integer", schema: S.Number({ jsonType: "integer" }) }
    ])("validates negative array elements against $name rather than rebinding them", async ({ schema }) => {
      const params = S.Object({ numbers: S.Array(schema), target: S.Number(), ...(dynamic ? { labels: S.Optional(S.Record(S.String())) } : {}) });
      const { handler, output } = await invoke(route, params, ["--numbers", "1", "-2.5", "--", "7"]);
      expect(process.exitCode).toBe(1);
      expect(handler).not.toHaveBeenCalled();
      expect(output.join("\n")).toContain('Invalid value for "numbers"');
      expect(output.join("\n")).not.toContain("Unknown option");
    });
  });
});
