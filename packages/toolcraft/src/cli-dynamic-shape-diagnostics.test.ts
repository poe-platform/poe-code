import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { S, type AnySchema, type ObjectSchema } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { runCLI } from "./cli.js";

const previousExitCode = process.exitCode;
beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = previousExitCode; });

async function invoke(schema: ObjectSchema<any>, args: string[], stream: boolean) {
  const received: unknown[] = [];
  const config = { name: "read", params: schema };
  const command = stream
    ? defineStreamCommand({ ...config, event: S.Json(), async *handler({ params }) { received.push(params); yield params; } })
    : defineCommand({ ...config, handler: ({ params }) => { received.push(params); return params; } });
  const emitted: string[] = [];
  await runCLI(defineGroup({ name: "audit", children: [command] }), {
    argv: ["node", "audit", "read", ...args, "--yes", "--output", "json"],
    controls: { yes: true, output: true },
    errorReports: false,
    outputEmitter: (entry) => emitted.push(entry)
  });
  return { received, emitted, exit: process.exitCode ?? 0 };
}

const compoundCases: Array<{ kind: string; schema: AnySchema }> = [
  { kind: "object", schema: S.Object({ name: S.String() }) },
  { kind: "record", schema: S.Record(S.String()) },
  { kind: "oneof", schema: S.OneOf({ discriminator: "kind", branches: { text: S.Object({ name: S.String() }) } }) },
  { kind: "union", schema: S.Union([S.Object({ name: S.String() }), S.Object({ count: S.Number() })]) }
];

describe.each([false, true])("dynamic argument diagnostics stream=%s", (stream) => {
  describe.each([false, true])("nested=%s", (nested) => {
    describe.each([false, true])("optional=%s", (optional) => {
      it.each(compoundCases)("identifies the unsupported $kind argument shape without advertising it as supported", async ({ kind, schema }) => {
        const entries = S.Record(optional ? S.Optional(schema) : schema);
        const params = S.Object(nested ? { config: S.Object({ entries }) } : { entries });
        const path = nested ? "config.entries.alpha" : "entries.alpha";
        const result = await invoke(params, [`--${path}`, "{}"], stream);

        expect(result.exit).toBe(1);
        expect(result.received).toEqual([]);
        expect(result.emitted).toHaveLength(1);
        expect(result.emitted[0]).toContain(`Unsupported CLI argument shape for "${path}" (type "${kind}").`);
        expect(result.emitted[0]).not.toContain("Supported types:");
      });
    });

    it.each(["object", "record"] as const)("still accepts nested flags for %s members", async (kind) => {
      const entries = S.Record(kind === "object" ? S.Object({ name: S.String() }) : S.Record(S.String()));
      const params = S.Object(nested ? { config: S.Object({ entries }) } : { entries });
      const path = nested ? "config.entries.alpha.name" : "entries.alpha.name";
      const result = await invoke(params, [`--${path}`, "Ada"], stream);

      expect(result.exit, result.emitted.join("\n")).toBe(0);
      const value = { entries: { alpha: { name: "Ada" } } };
      expect(result.received).toEqual([nested ? { config: value } : value]);
    });
  });

  it.each([
    { kind: "string", schema: S.String(), args: ["Ada"], value: "Ada" },
    { kind: "number", schema: S.Number(), args: ["2"], value: 2 },
    { kind: "boolean", schema: S.Boolean(), args: ["false"], value: false },
    { kind: "enum", schema: S.Enum(["ready"]), args: ["ready"], value: "ready" },
    { kind: "array", schema: S.Array(S.String()), args: ["Ada", "Bob"], value: ["Ada", "Bob"] },
    { kind: "json", schema: S.Json(), args: ['{"name":"Ada"}'], value: { name: "Ada" } }
  ])("preserves supported $kind leaf values", async ({ schema, args, value }) => {
    const result = await invoke(S.Object({ entries: S.Record(schema) }), ["--entries.alpha", ...args], stream);

    expect(result.exit, result.emitted.join("\n")).toBe(0);
    expect(result.received).toEqual([{ entries: { alpha: value } }]);
  });
});
