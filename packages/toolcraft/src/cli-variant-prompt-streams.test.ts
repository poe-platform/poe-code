import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S, type AnySchema } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";

const prompts = vi.hoisted(() => ({ text: vi.fn(), select: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), cancelled: Symbol("cancel") }));
vi.mock("toolcraft-design", async (importOriginal) => ({
  ...await importOriginal<typeof import("toolcraft-design")>(),
  promptText: prompts.text,
  select: prompts.select,
  confirm: prompts.confirm,
  cancel: prompts.cancel,
  isCancel: (value: unknown) => value === prompts.cancelled
}));

const previousExitCode = process.exitCode;
const streams: PassThrough[] = [];
beforeEach(() => {
  process.exitCode = 0;
  prompts.text.mockReset().mockResolvedValue("answer");
  prompts.confirm.mockReset().mockResolvedValue(false);
  prompts.select.mockReset().mockImplementation(async (options: { options: Array<{ value: unknown }> }) =>
    options.options.some((option) => option.value === "other") ? "other" : options.options[0]?.value
  );
  prompts.cancel.mockClear();
});
afterEach(() => {
  for (const stream of streams.splice(0)) stream.destroy();
  process.exitCode = previousExitCode;
});

const fields = [
  { name: "text", schema: S.String(), value: "answer", args: ["answer"], prompt: "text" },
  { name: "enum", schema: S.Enum(["answer", "other"]), value: "other", args: ["other"], prompt: "select" },
  { name: "boolean", schema: S.Boolean(), value: false, args: [], prompt: "confirm" }
] as const;

function fixture(kind: "discriminator" | "union", schema: AnySchema, nested = false, optional = false) {
  const branch = S.Object({ target: schema });
  const variant = kind === "discriminator" ? S.OneOf({ discriminator: "mode", branches: { safe: branch } }) : S.Union([branch]);
  const payload = optional ? S.Optional(variant) : variant;
  const params = S.Object(nested ? { outer: S.Object({ payload }) } : { payload });
  const handler = vi.fn(({ params }: { params: Record<string, unknown> }) => params);
  const root = defineGroup({ name: "audit", children: [defineCommand({ name: "check", params, handler })] });
  const prefix = nested ? "outer.payload" : "payload";
  const selector = kind === "discriminator" ? [`--${prefix}.mode`, "safe"] : [`--${prefix}-kind`, "target"];
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const output = Object.assign(new PassThrough(), { isTTY: true });
  streams.push(input, output);
  return { root, handler, prefix, selector, input, output };
}

describe.each(["discriminator", "union"] as const)("CLI %s prompt streams", (kind) => {
  describe.each(fields)("$name", (field) => {
    describe.each([false, true])("nested object: %s", (nested) => {
      it.each(["provided", "prompted", "deferred"])("routes %s selector and branch prompts", async (selection) => {
        const { root, handler, selector, input, output } = fixture(kind, field.schema, nested, selection === "deferred");
        await runCLI(root, {
          argv: ["node", "audit", "check", ...(selection === "provided" ? selector : [])],
          promptInput: input, promptOutput: output, errorReports: false, outputEmitter: () => {}
        });
        expect(process.exitCode).toBe(0);
        const payload = { ...(kind === "discriminator" ? { mode: "safe" } : {}), target: field.value };
        expect(handler).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledWith(expect.objectContaining({ params: nested ? { outer: { payload } } : { payload } }));
        const calls = [...prompts.text.mock.calls, ...prompts.select.mock.calls, ...prompts.confirm.mock.calls];
        expect(calls.length).toBeGreaterThan(0);
        for (const call of calls) {
          expect(call[0].input).toBe(input);
          expect(call[0].output).toBe(output);
        }
      });
    });

    it("routes cancellation without invoking the handler", async () => {
      const { root, handler, selector, input, output } = fixture(kind, field.schema);
      prompts[field.prompt].mockResolvedValueOnce(prompts.cancelled);
      await runCLI(root, {
        argv: ["node", "audit", "check", ...selector],
        promptInput: input, promptOutput: output, errorReports: false, outputEmitter: () => {}
      });
      expect(process.exitCode).toBe(1);
      expect(handler).not.toHaveBeenCalled();
      expect(prompts.cancel).not.toHaveBeenCalled();
      expect(prompts[field.prompt]).toHaveBeenCalledWith(expect.objectContaining({ input, output }));
    });

    it("does not prompt for an explicitly supplied branch value", async () => {
      const { root, handler, selector, prefix, input, output } = fixture(kind, field.schema);
      await runCLI(root, {
        argv: ["node", "audit", "check", ...selector, `--${field.name === "boolean" ? "no-" : ""}${prefix}.target`, ...field.args],
        promptInput: input, promptOutput: output, errorReports: false, outputEmitter: () => {}
      });
      expect(process.exitCode).toBe(0);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ params: { payload: { ...(kind === "discriminator" ? { mode: "safe" } : {}), target: field.value } } }));
      expect(prompts.text).not.toHaveBeenCalled();
      expect(prompts.select).not.toHaveBeenCalled();
      expect(prompts.confirm).not.toHaveBeenCalled();
    });
  });
});
