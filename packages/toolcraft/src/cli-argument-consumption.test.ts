import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import type { ObjectSchema } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";

const previousExitCode = process.exitCode;
beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = previousExitCode; });

interface ArgumentCase {
  name: string;
  params: ObjectSchema<any>;
  positional: string[];
  args: string[];
  expected?: unknown;
}

const labels = S.Record(S.String());
const cases: ArgumentCase[] = [
  { name: "extra word without positionals", params: S.Object({}), positional: [], args: ["unexpected"] },
  { name: "extra empty word without positionals", params: S.Object({}), positional: [], args: [""] },
  { name: "extra word after a scalar", params: S.Object({ target: S.String() }), positional: ["target"], args: ["sample", "unexpected"] },
  { name: "extra word after a record value", params: S.Object({ labels }), positional: [], args: ["--labels.env", "prod", "unexpected"] },
  { name: "extra word before a record flag", params: S.Object({ labels }), positional: [], args: ["unexpected", "--labels.env", "prod"] },
  { name: "extra word after inline record value", params: S.Object({ labels }), positional: [], args: ["--labels.env=prod", "unexpected"] },
  { name: "extra word after record and scalar", params: S.Object({ target: S.String(), labels }), positional: ["target"], args: ["sample", "--labels.env", "prod", "unexpected"] },
  { name: "extra word following separator", params: S.Object({ labels }), positional: [], args: ["--labels.env", "prod", "--", "unexpected"] },
  { name: "two valid scalar positionals", params: S.Object({ source: S.String(), target: S.String() }), positional: ["source", "target"], args: ["first", "second"], expected: { source: "first", target: "second" } },
  { name: "valid empty scalar", params: S.Object({ target: S.String() }), positional: ["target"], args: [""], expected: { target: "" } },
  { name: "valid scalar before record", params: S.Object({ target: S.String(), labels }), positional: ["target"], args: ["sample", "--labels.env", "prod"], expected: { target: "sample", labels: { env: "prod" } } },
  { name: "valid scalar after record", params: S.Object({ target: S.String(), labels }), positional: ["target"], args: ["--labels.env", "prod", "sample"], expected: { target: "sample", labels: { env: "prod" } } },
  { name: "valid scalar after inline record", params: S.Object({ target: S.String(), labels }), positional: ["target"], args: ["--labels.env=prod", "sample"], expected: { target: "sample", labels: { env: "prod" } } },
  { name: "valid empty scalar after record", params: S.Object({ target: S.String(), labels }), positional: ["target"], args: ["--labels.env", "prod", ""], expected: { target: "", labels: { env: "prod" } } },
  { name: "valid variadic", params: S.Object({ targets: S.Array(S.String()) }), positional: ["targets"], args: ["one", "two"], expected: { targets: ["one", "two"] } },
  { name: "variadic before record", params: S.Object({ targets: S.Array(S.String()), labels }), positional: ["targets"], args: ["one", "two", "--labels.env", "prod"], expected: { targets: ["one", "two"], labels: { env: "prod" } } },
  { name: "variadic after record", params: S.Object({ targets: S.Array(S.String()), labels }), positional: ["targets"], args: ["--labels.env", "prod", "one", "two"], expected: { targets: ["one", "two"], labels: { env: "prod" } } },
  { name: "record between scalar positionals", params: S.Object({ source: S.String(), target: S.String(), labels }), positional: ["source", "target"], args: ["one", "--labels.env", "prod", "two"], expected: { source: "one", target: "two", labels: { env: "prod" } } },
  { name: "separator preserves option-looking positional", params: S.Object({ target: S.String(), labels: S.Optional(labels) }), positional: ["target"], args: ["--", "--labels.env=literal"], expected: { target: "--labels.env=literal" } },
  { name: "separator after record preserves option-looking positional", params: S.Object({ target: S.String(), labels }), positional: ["target"], args: ["--labels.env", "prod", "--", "--labels.env=literal"], expected: { target: "--labels.env=literal", labels: { env: "prod" } } },
  { name: "separator preserves variadic tokens", params: S.Object({ targets: S.Array(S.String()), labels }), positional: ["targets"], args: ["--labels.env", "prod", "--", "--labels.other=x", "-x", ""], expected: { targets: ["--labels.other=x", "-x", ""], labels: { env: "prod" } } },
  { name: "dynamic scalar with no positionals", params: S.Object({ labels }), positional: [], args: ["--labels.env", "prod"], expected: { labels: { env: "prod" } } },
  { name: "dynamic numeric array consumes all values", params: S.Object({ weights: S.Record(S.Array(S.Number())) }), positional: [], args: ["--weights.main", "-1", "2", "3"], expected: { weights: { main: [-1, 2, 3] } } },
  { name: "dynamic string array consumes all values", params: S.Object({ labels: S.Record(S.Array(S.String())) }), positional: [], args: ["--labels.env", "prod", "backup", "-"], expected: { labels: { env: ["prod", "backup", "-"] } } },
  { name: "dynamic booleans retain following positional", params: S.Object({ flags: S.Record(S.Boolean()), target: S.String() }), positional: ["target"], args: ["--flags.enabled", "sample"], expected: { flags: { enabled: true }, target: "sample" } },
  { name: "dynamic explicit boolean consumes only its value", params: S.Object({ flags: S.Record(S.Boolean()), target: S.String() }), positional: ["target"], args: ["--flags.enabled", "false", "sample"], expected: { flags: { enabled: false }, target: "sample" } },
  { name: "dynamic negative boolean retains following positional", params: S.Object({ flags: S.Record(S.Boolean()), target: S.String() }), positional: ["target"], args: ["--no-flags.enabled", "sample"], expected: { flags: { enabled: false }, target: "sample" } },
  { name: "known flag interleaved with record and positional", params: S.Object({ labels, target: S.String(), count: S.Number() }), positional: ["target"], args: ["--labels.env", "prod", "--count", "2", "sample"], expected: { labels: { env: "prod" }, target: "sample", count: 2 } },
  { name: "dynamic array stops at positional separator", params: S.Object({ labels: S.Record(S.Array(S.String())), target: S.String() }), positional: ["target"], args: ["--labels.env", "prod", "backup", "--", "sample"], expected: { labels: { env: ["prod", "backup"] }, target: "sample" } },
  { name: "negative numeric positional after record", params: S.Object({ labels, count: S.Number() }), positional: ["count"], args: ["--labels.env", "prod", "-3"], expected: { labels: { env: "prod" }, count: -3 } },
  { name: "scalar and variadic with record between", params: S.Object({ source: S.String(), targets: S.Array(S.String()), labels }), positional: ["source", "targets"], args: ["source", "--labels.env", "prod", "first", "second"], expected: { source: "source", targets: ["first", "second"], labels: { env: "prod" } } },
  { name: "optional variadic remains absent", params: S.Object({ labels, targets: S.Optional(S.Array(S.String())) }), positional: ["targets"], args: ["--labels.env", "prod"], expected: { labels: { env: "prod" } } },
  { name: "unknown option remains rejected", params: S.Object({}), positional: [], args: ["--unexpected"] },
  { name: "unknown dynamic option remains rejected", params: S.Object({ labels }), positional: [], args: ["--unknown.value", "oops"] }
];

describe.each(["direct", "nested", "alias", "default", "nested default"])("CLI argument consumption via %s", (route) => {
  it.each(cases)("$name", async ({ params, positional, args, expected }) => {
    const handler = vi.fn((context: { params: unknown }) => context.params);
    const command = defineCommand({ name: "check", aliases: ["inspect"], params, positional, handler });
    const nested = route === "nested" || route === "nested default";
    const group = defineGroup({ name: "group", children: [command], ...(route === "nested default" ? { default: command } : {}) });
    const root = defineGroup({ name: "audit", children: [nested ? group : command], ...(route === "default" ? { default: command } : {}) });
    const commandArgs = route === "default" || route === "nested default" ? [] : [route === "alias" ? "inspect" : "check"];
    const output: string[] = [];
    await runCLI(root, {
      argv: ["node", "audit", ...(nested ? ["group"] : []), ...commandArgs, ...args],
      errorReports: false,
      outputEmitter: (entry) => output.push(entry)
    });
    if (expected === undefined) {
      expect(process.exitCode).toBe(1);
      expect(handler).not.toHaveBeenCalled();
      expect(output.join("\n")).toContain("--help");
    } else {
      expect(process.exitCode).toBe(0);
      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]?.[0].params).toEqual(expected);
    }
  });
});
