import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S, type AnySchema, type ObjectSchema } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
vi.mock("node:fs", async () => (await import("memfs")).fs);

const previousExitCode = process.exitCode;
beforeEach(() => { process.exitCode = 0; vol.reset(); });
afterEach(() => { process.exitCode = previousExitCode; vol.reset(); });

async function invoke(schema: ObjectSchema<any>, preset: unknown, args: string[] = [], handler = vi.fn(({ params }: { params: any }) => params)) {
  const bytes = JSON.stringify(preset);
  vol.fromJSON({ "/presets/values.json": bytes });
  const original = JSON.stringify(schema);
  const output: string[] = [];
  await runCLI(defineGroup({ name: "audit", children: [defineCommand({ name: "check", params: schema, handler })] }), {
    argv: ["node", "audit", "check", "--yes", "--preset", "/presets/values.json", ...args],
    controls: { yes: true }, presets: true, approvals: false, errorReports: false,
    outputEmitter: (entry) => output.push(entry)
  });
  expect(vol.readFileSync("/presets/values.json", "utf8")).toBe(bytes);
  expect(JSON.stringify(schema)).toBe(original);
  return { handler, output };
}

interface PresetCase {
  name: string;
  schema: AnySchema;
  value: unknown;
  expected?: unknown;
}

const validCases: PresetCase[] = [
  { name: "record strings", schema: S.Record(S.String()), value: { alpha: "ready" } },
  { name: "record numbers", schema: S.Record(S.Number({ jsonType: "integer", minimum: 0 })), value: { alpha: 2 } },
  { name: "record booleans", schema: S.Record(S.Boolean()), value: { alpha: false } },
  { name: "record arrays", schema: S.Record(S.Array(S.String())), value: { alpha: ["ready"] } },
  { name: "record objects", schema: S.Record(S.Object({ label: S.String() })), value: { alpha: { label: "ready" } } },
  { name: "nested records", schema: S.Record(S.Record(S.String())), value: { alpha: { beta: "ready" } } },
  { name: "object arrays", schema: S.Array(S.Object({ label: S.String() })), value: [{ label: "ready" }] },
  { name: "optional object items", schema: S.Array(S.Optional(S.Object({ label: S.String() }))), value: [{ label: "ready" }] },
  { name: "empty records", schema: S.Record(S.String()), value: {} },
  { name: "empty arrays", schema: S.Array(S.Object({ label: S.String() })), value: [] },
  { name: "nullable records", schema: { ...S.Record(S.String()), nullable: true }, value: null },
  { name: "nullable arrays", schema: S.Array(S.Object({ label: S.String() }), { nullable: true }), value: null },
  { name: "required child default", schema: S.Record(S.Object({ label: S.String(), count: S.Number({ default: 2 }) })), value: { alpha: { label: "ready" } }, expected: { alpha: { label: "ready", count: 2 } } },
  { name: "optional child default", schema: S.Array(S.Object({ label: S.String(), count: S.Optional(S.Number({ default: 2 })) })), value: [{ label: "ready" }], expected: [{ label: "ready", count: 2 }] },
  { name: "canonical property casing", schema: S.Record(S.Object({ "display-name": S.String() })), value: { alpha: { "display-name": "ready" } } },
  { name: "record key punctuation", schema: S.Record(S.String()), value: { "alpha.beta": "ready", "空": "ready" } },
  { name: "additional object members", schema: S.Array(S.Object({ label: S.String() }, { additionalProperties: true })), value: [{ label: "ready", extra: { values: [1] } }] },
  { name: "nested object arrays", schema: S.Record(S.Array(S.Object({ label: S.String() }))), value: { alpha: [{ label: "ready" }] } },
  { name: "nullable object items", schema: S.Array(S.Object({ label: S.String() }, { nullable: true })), value: [null, { label: "ready" }] },
  { name: "null child default", schema: S.Record(S.Object({ values: S.Array(S.String(), { nullable: true, default: null }) })), value: { alpha: {} }, expected: { alpha: { values: null } } },
  { name: "whole child-object default", schema: S.Array(S.Object({ settings: S.Object({ label: S.String() }, { default: { label: "seed" } }) })), value: [{}], expected: [{ settings: { label: "seed" } }] },
  { name: "record OneOf values", schema: S.Record(S.OneOf({ discriminator: "kind", branches: { left: S.Object({ label: S.String(), count: S.Number({ default: 2 }) }), right: S.Object({ other: S.String() }) } })), value: { alpha: { kind: "left", label: "ready" } }, expected: { alpha: { kind: "left", label: "ready", count: 2 } } },
  { name: "record Union values", schema: S.Record(S.Union([S.Object({ label: S.String(), count: S.Number({ default: 2 }) }), S.Object({ other: S.String() })])), value: { alpha: { label: "ready" } }, expected: { alpha: { label: "ready", count: 2 } } },
  { name: "absent optional child", schema: S.Array(S.Object({ settings: S.Optional(S.Object({ note: S.String({ default: "seed" }) })) })), value: [{}] }
];

describe.each(["required", "optional", "nested", "mixed"] as const)("%s dynamic presets", (placement) => {
  it.each(validCases)("accepts $name", async ({ schema: field, value, expected }) => {
    const entrySchema = S.Object({ entries: placement === "optional" ? S.Optional(field) : field, ...(placement === "mixed" ? { label: S.String() } : {}) });
    const schema = placement === "nested" ? S.Object({ settings: entrySchema }) : entrySchema;
    const input = { entries: value, ...(placement === "mixed" ? { label: "fixture" } : {}) };
    const resolved = { entries: expected === undefined ? value : expected, ...(placement === "mixed" ? { label: "fixture" } : {}) };
    const { handler, output } = await invoke(schema, placement === "nested" ? { settings: input } : input);
    expect(process.exitCode, output.join("\n")).toBe(0);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0].params).toEqual(placement === "nested" ? { settings: resolved } : resolved);
  });
});

describe("invalid dynamic presets", () => {
  it.each([
    { name: "record scalar", schema: S.Record(S.String()), value: "wrong", path: "entries" },
    { name: "record array", schema: S.Record(S.String()), value: [], path: "entries" },
    { name: "nonnull record", schema: S.Record(S.String()), value: null, path: "entries" },
    { name: "string coercion", schema: S.Record(S.String()), value: { alpha: 2 }, path: "entries.alpha" },
    { name: "number coercion", schema: S.Record(S.Number()), value: { alpha: "2" }, path: "entries.alpha" },
    { name: "number bound", schema: S.Record(S.Number({ minimum: 2 })), value: { alpha: 1 }, path: "entries.alpha" },
    { name: "integer fraction", schema: S.Record(S.Number({ jsonType: "integer" })), value: { alpha: 1.5 }, path: "entries.alpha" },
    { name: "string pattern", schema: S.Record(S.String({ pattern: "^ready$" })), value: { alpha: "wrong" }, path: "entries.alpha" },
    { name: "Unicode length", schema: S.Record(S.String({ maxLength: 1 })), value: { alpha: "😀😀" }, path: "entries.alpha" },
    { name: "unknown child", schema: S.Record(S.Object({ label: S.String() })), value: { alpha: { label: "ready", extra: true } }, path: "entries.alpha.extra" },
    { name: "missing child", schema: S.Record(S.Object({ label: S.String() })), value: { alpha: {} }, path: "entries.alpha.label" },
    { name: "indexed object instead of array", schema: S.Array(S.Object({ label: S.String() })), value: { "0": { label: "ready" } }, path: "entries" },
    { name: "nonnull array", schema: S.Array(S.Object({ label: S.String() })), value: null, path: "entries" },
    { name: "array item", schema: S.Array(S.Object({ label: S.String() })), value: [{ label: 2 }], path: "entries.0.label" },
    { name: "minimum item count", schema: S.Array(S.Object({ label: S.String() }), { minItems: 1 }), value: [], path: "entries" },
    { name: "maximum item count", schema: S.Array(S.Object({ label: S.String() }), { maxItems: 1 }), value: [{ label: "A" }, { label: "B" }], path: "entries" }
  ])("reports a preset path for $name", async ({ schema: field, value, path }) => {
    const { handler, output } = await invoke(S.Object({ entries: field }), { entries: value });
    expect(process.exitCode).toBe(1);
    expect(handler).not.toHaveBeenCalled();
    expect(output.join("\n")).toContain('Preset file "/presets/values.json"');
    expect(output.join("\n")).toContain(`"${path}"`);
    expect(output.join("\n")).not.toContain("unknown parameter");
  });
});

describe("dynamic preset precedence and variants", () => {
  it.each(["record", "array"] as const)("replaces the whole %s with explicit flags", async (kind) => {
    const field = kind === "record" ? S.Record(S.Object({ label: S.String() })) : S.Array(S.Object({ label: S.String() }));
    const preset = kind === "record" ? { alpha: { label: "preset" }, beta: { label: "retained?" } } : [{ label: "preset" }, { label: "retained?" }];
    const expected = kind === "record" ? { alpha: { label: "explicit" } } : [{ label: "explicit" }];
    const { handler, output } = await invoke(S.Object({ entries: field }), { entries: preset }, [`--entries.${kind === "record" ? "alpha" : "0"}.label`, "explicit"]);
    expect(process.exitCode, output.join("\n")).toBe(0);
    expect(handler.mock.calls[0]![0].params).toEqual({ entries: expected });
  });

  it.each(["record", "array"] as const)("does not fill partial %s flags from a preset", async (kind) => {
    const entry = S.Object({ label: S.String(), note: S.Optional(S.String()) });
    const field = kind === "record" ? S.Record(entry) : S.Array(entry);
    const preset = kind === "record" ? { alpha: { label: "preset" } } : [{ label: "preset" }];
    const { handler, output } = await invoke(S.Object({ entries: field }), { entries: preset }, [`--entries.${kind === "record" ? "alpha" : "0"}.note`, "memo"]);
    expect(process.exitCode).toBe(1);
    expect(handler).not.toHaveBeenCalled();
    expect(output.join("\n")).toContain("label");
  });

  it.each(["record", "array"] as const)("allows explicit %s flags to replace a nullable preset", async (kind) => {
    const field = kind === "record" ? { ...S.Record(S.String()), nullable: true } : S.Array(S.Object({ label: S.String() }), { nullable: true });
    const args = kind === "record" ? ["--entries.alpha", "ready"] : ["--entries.0.label", "ready"];
    const { handler, output } = await invoke(S.Object({ entries: field }), { entries: null }, args);
    expect(process.exitCode, output.join("\n")).toBe(0);
    expect(handler.mock.calls[0]![0].params).toEqual({ entries: kind === "record" ? { alpha: "ready" } : [{ label: "ready" }] });
  });

  it("still rejects invalid preset values when a flag overrides them", async () => {
    const { handler, output } = await invoke(S.Object({ entries: S.Record(S.Number()) }), { entries: { alpha: "invalid" } }, ["--entries.alpha", "2"]);
    expect(process.exitCode).toBe(1);
    expect(handler).not.toHaveBeenCalled();
    expect(output.join("\n")).toContain("entries.alpha");
  });

  it.each(["oneOf", "union"] as const)("accepts the selected %s branch and rejects inactive preset members", async (kind) => {
    const selected = S.Object({ entries: S.Record(S.String()) });
    const other = S.Object({ other: S.String() });
    const schema = S.Object({ payload: kind === "oneOf" ? S.OneOf({ discriminator: "kind", branches: { selected, other } }) : S.Union([selected, other]) });
    const input = { payload: { ...(kind === "oneOf" ? { kind: "selected" } : {}), entries: { alpha: "ready" } } };
    const valid = await invoke(schema, input, kind === "union" ? ["--payload-kind", "entries"] : []);
    expect(process.exitCode, valid.output.join("\n")).toBe(0);
    expect(valid.handler.mock.calls[0]![0].params).toEqual(input);
    process.exitCode = 0;
    const invalid = await invoke(schema, { payload: { ...(kind === "oneOf" ? { kind: "other" } : {}), entries: {}, other: "ready" } }, kind === "union" ? ["--payload-kind", "other"] : []);
    expect(process.exitCode).toBe(1);
    expect(invalid.handler).not.toHaveBeenCalled();
    expect(invalid.output.join("\n")).toContain('Unknown parameter "payload.entries"');
  });

  it("keeps absent optional dynamic fields absent", async () => {
    const { handler } = await invoke(S.Object({ entries: S.Optional(S.Record(S.String())) }), {});
    expect(process.exitCode).toBe(0);
    expect(handler.mock.calls[0]![0].params).toEqual({});
  });

  it("applies omitted collection defaults without replacing explicit empty collections", async () => {
    const field = { ...S.Record(S.String()), default: { alpha: "seed" } };
    const omitted = await invoke(S.Object({ entries: field }), {});
    expect(process.exitCode).toBe(0);
    expect(omitted.handler.mock.calls[0]![0].params).toEqual({ entries: { alpha: "seed" } });
    const empty = await invoke(S.Object({ entries: field }), { entries: {} });
    expect(process.exitCode).toBe(0);
    expect(empty.handler.mock.calls[0]![0].params).toEqual({ entries: {} });
  });

  it("isolates applied child defaults between entries and invocations", async () => {
    const original = ["seed"];
    const schema = S.Object({ entries: S.Record(S.Object({ label: S.String(), values: S.Array(S.String(), { default: original }) })) });
    const before: unknown[] = [];
    const handler = vi.fn(({ params }: { params: any }) => {
      before.push(structuredClone(params));
      params.entries.alpha.values.push("mutated");
      expect(params.entries.beta.values).toEqual(["seed"]);
      return {};
    });
    const input = { entries: { alpha: { label: "A" }, beta: { label: "B" } } };
    for (const iteration of [1, 2]) {
      const result = await invoke(schema, input, [], handler);
      expect(process.exitCode, result.output.join("\n")).toBe(0);
      expect(handler).toHaveBeenCalledTimes(iteration);
    }
    expect(before[0]).toEqual(before[1]);
    expect(original).toEqual(["seed"]);
  });
});
