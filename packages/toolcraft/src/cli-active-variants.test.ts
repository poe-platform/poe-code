import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S, validate, type AnySchema, type ObjectSchema } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";

const prompts = vi.hoisted(() => ({ select: vi.fn(), text: vi.fn() }));
vi.mock("toolcraft-design", async (importOriginal) => ({
  ...await importOriginal<typeof import("toolcraft-design")>(),
  select: prompts.select,
  promptText: prompts.text
}));

type VariantKind = "oneOf" | "union";
const previousExitCode = process.exitCode;
const streams: PassThrough[] = [];
const answers = new Map<string, string>();
beforeEach(() => {
  process.exitCode = 0;
  answers.clear();
  prompts.select.mockReset().mockImplementation(async ({ message }: { message: string }) => {
    if (!answers.has(message)) throw new Error(`Unexpected selector prompt: ${message}`);
    return answers.get(message);
  });
  prompts.text.mockReset().mockImplementation(async ({ message }: { message: string }) => {
    throw new Error(`Unexpected value prompt: ${message}`);
  });
});
afterEach(() => {
  for (const stream of streams.splice(0)) stream.destroy();
  process.exitCode = previousExitCode;
});

function variant(kind: VariantKind, branches: Record<string, ObjectSchema<any>>): AnySchema {
  return kind === "oneOf" ? S.OneOf({ discriminator: "kind", branches }) : S.Union(Object.values(branches));
}

function selection(kind: VariantKind, path: string, name: string, branch: ObjectSchema<any>): string[] {
  return [
    kind === "oneOf" ? `--${path}.kind` : `--${path}-kind`,
    kind === "oneOf" ? name : Object.entries(branch.shape).filter(([, schema]) => (schema as AnySchema).kind !== "optional").map(([key]) => key).sort().join("+")
  ];
}

async function invoke(schema: ObjectSchema<any>, argv: string[], interactive: boolean, handler = vi.fn(({ params }: { params: Record<string, unknown> }) => params)) {
  const input = Object.assign(new PassThrough(), { isTTY: interactive });
  const output = Object.assign(new PassThrough(), { isTTY: interactive });
  streams.push(input, output);
  const emitted: string[] = [];
  const root = defineGroup({ name: "audit", children: [defineCommand({ name: "check", params: schema, handler })] });
  process.exitCode = 0;
  await runCLI(root, {
    argv: ["node", "audit", "check", ...argv, ...(!interactive ? ["--yes"] : [])],
    controls: { yes: true }, promptInput: input, promptOutput: output,
    errorReports: false, outputEmitter: (entry) => emitted.push(entry)
  });
  return { handler, emitted, input, output };
}

const modes = [
  { name: "noninteractive", interactive: false, prompted: false },
  { name: "interactive supplied selector", interactive: true, prompted: false },
  { name: "interactive prompted selector", interactive: true, prompted: true }
];

describe.each(["oneOf", "union"] as const)("active outer %s", (outerKind) => {
  describe.each(["oneOf", "union"] as const)("nested %s", (innerKind) => {
    describe.each(modes)("$name", ({ interactive, prompted }) => {
      it.each([
        { name: "empty", body: S.Object({}) },
        { name: "required", body: S.Object({ ignored: S.String() }) },
        { name: "defaulted", body: S.Object({ ignored: S.String({ default: "ignored" }) }) }
      ])("does not activate an inactive $name descendant", async ({ body }) => {
        for (const optional of [false, true]) {
          const chosen = S.Object({ value: S.String() });
          const outer = variant(outerKind, { chosen, other: S.Object({ nested: variant(innerKind, { ignored: body }) }) });
          const schema = S.Object({ payload: optional ? S.Optional(outer) : outer });
          const selector = selection(outerKind, "payload", "chosen", chosen);
          if (prompted) answers.set(selector[0]!, selector[1]!);
          const { handler, emitted, input, output } = await invoke(schema, [...(prompted ? [] : selector), "--payload.value", "ready"], interactive);
          expect(process.exitCode, emitted.join("\n")).toBe(0);
          expect(handler).toHaveBeenCalledOnce();
          expect(handler.mock.calls[0]![0].params).toEqual({ payload: { ...(outerKind === "oneOf" ? { kind: "chosen" } : {}), value: "ready" } });
          expect(validate(schema, handler.mock.calls[0]![0].params).ok).toBe(true);
          expect(prompts.text).not.toHaveBeenCalled();
          if (prompted) expect(prompts.select).toHaveBeenLastCalledWith(expect.objectContaining({ message: selector[0], input, output }));
          else expect(prompts.select).not.toHaveBeenCalled();
        }
      });

      it.each(["string", "record"])("requires only the chosen grandchild, not inactive %s fields", async (inactiveType) => {
        const left = S.Object({ left: S.String() });
        const inner = variant(innerKind, { left, right: S.Object({ right: inactiveType === "string" ? S.String() : S.Record(S.String()) }) });
        const chosen = S.Object({ present: S.String(), nested: inner });
        const schema = S.Object({ payload: variant(outerKind, { chosen, other: S.Object({ other: S.String() }) }) });
        const innerSelector = selection(innerKind, "payload.nested", "left", left);
        if (prompted) answers.set(innerSelector[0]!, innerSelector[1]!);
        const { handler, emitted } = await invoke(schema, [
          ...selection(outerKind, "payload", "chosen", chosen), "--payload.present", "ready",
          ...(prompted ? [] : innerSelector), "--payload.nested.left", "value"
        ], interactive);
        expect(process.exitCode, emitted.join("\n")).toBe(0);
        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0]![0].params).toEqual({ payload: {
          ...(outerKind === "oneOf" ? { kind: "chosen" } : {}), present: "ready",
          nested: { ...(innerKind === "oneOf" ? { kind: "left" } : {}), left: "value" }
        } });
        expect(validate(schema, handler.mock.calls[0]![0].params).ok).toBe(true);
        expect(prompts.text).not.toHaveBeenCalled();
        expect(prompts.select).toHaveBeenCalledTimes(prompted ? 1 : 0);
      });
    });

    it.each([false, true])("rejects explicit inactive grandchildren without prompts, interactive=%s", async (interactive) => {
      const left = S.Object({ left: S.String() });
      const chosen = S.Object({ nested: variant(innerKind, { left, right: S.Object({ right: S.String() }) }) });
      const schema = S.Object({ payload: variant(outerKind, { chosen }) });
      const { handler, emitted } = await invoke(schema, [
        ...selection(outerKind, "payload", "chosen", chosen), ...selection(innerKind, "payload.nested", "left", left),
        "--payload.nested.left", "ready", "--payload.nested.right", "wrong"
      ], interactive);
      expect(process.exitCode).toBe(1);
      expect(handler).not.toHaveBeenCalled();
      expect(emitted.join("\n")).toContain('Unknown parameter "payload.nested.right"');
      expect(prompts.select).not.toHaveBeenCalled();
      expect(prompts.text).not.toHaveBeenCalled();
    });

    it.each([false, true])("preserves nested selector requiredness, optional=%s", async (optional) => {
      const inner = variant(innerKind, { left: S.Object({ left: S.String() }), right: S.Object({ right: S.String() }) });
      const chosen = S.Object({ present: S.String(), nested: optional ? S.Optional(inner) : inner });
      const schema = S.Object({ payload: variant(outerKind, { chosen }) });
      const { handler, emitted } = await invoke(schema, [...selection(outerKind, "payload", "chosen", chosen), "--payload.present", "ready"], false);
      if (optional) {
        expect(process.exitCode, emitted.join("\n")).toBe(0);
        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0]![0].params).toEqual({ payload: { ...(outerKind === "oneOf" ? { kind: "chosen" } : {}), present: "ready" } });
      } else {
        expect(process.exitCode).toBe(1);
        expect(handler).not.toHaveBeenCalled();
        expect(emitted.join("\n")).toContain(innerKind === "oneOf" ? "payload.nested.kind" : "payload.nested-kind");
      }
      expect(prompts.select).not.toHaveBeenCalled();
      expect(prompts.text).not.toHaveBeenCalled();
    });
  });
});

describe.each(["oneOf", "union"] as const)("selected %s defaults", (kind) => {
  describe.each(modes)("$name", ({ interactive, prompted }) => {
    it.each(["string", "array", "json", "record", "array-object"])("binds only active %s defaults and preserves isolation", async (defaultKind) => {
      const original = defaultKind === "string" ? "seed" : defaultKind === "array" ? ["seed"] : defaultKind === "array-object" ? [{ items: ["seed"] }] : { items: ["seed"] };
      const valueSchema = defaultKind === "string" ? S.String({ default: "seed" })
        : defaultKind === "array" ? S.Array(S.String(), { default: original as string[] })
        : defaultKind === "json" ? { ...S.Json(), default: original }
        : defaultKind === "record" ? { ...S.Record(S.Array(S.String())), default: original }
        : S.Array(S.Object({ items: S.Array(S.String()) }), { default: original as Array<{ items: string[] }> });
      const chosen = S.Object({ chosen: S.String(), value: valueSchema });
      const schema = S.Object({ payload: variant(kind, { chosen, other: S.Object({ other: S.String(), ignored: valueSchema }) }) });
      const expected = { payload: { ...(kind === "oneOf" ? { kind: "chosen" } : {}), chosen: "ready", value: structuredClone(original) } };
      const selector = selection(kind, "payload", "chosen", chosen);
      if (prompted) answers.set(selector[0]!, selector[1]!);
      const before: unknown[] = [];
      const handler = vi.fn(({ params }: { params: Record<string, unknown> }) => {
        before.push(structuredClone(params));
        const value = (params.payload as Record<string, unknown>).value;
        if (defaultKind === "array") (value as string[]).push("changed");
        else if (defaultKind === "array-object") (value as Array<{ items: string[] }>)[0]!.items.push("changed");
        else if (defaultKind !== "string") (value as { items: string[] }).items.push("changed");
        return params;
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        const { emitted } = await invoke(schema, [...(prompted ? [] : selector), "--payload.chosen", "ready"], interactive, handler);
        expect(process.exitCode, emitted.join("\n")).toBe(0);
      }
      expect(before).toEqual([expected, expected]);
      expect(before.every((params) => validate(schema, params).ok)).toBe(true);
      expect(original).toEqual(expected.payload.value);
      expect(prompts.text).not.toHaveBeenCalled();
      expect(prompts.select).toHaveBeenCalledTimes(prompted ? 2 : 0);
    });
  });
});
