import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";

const prompts = vi.hoisted(() => ({ confirm: vi.fn(), text: vi.fn() }));
vi.mock("toolcraft-design", async (importOriginal) => ({
  ...await importOriginal<typeof import("toolcraft-design")>(),
  confirm: prompts.confirm,
  promptText: prompts.text
}));

const previousTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const previousExitCode = process.exitCode;
const streams: PassThrough[] = [];
beforeEach(() => {
  process.exitCode = 0;
  prompts.confirm.mockReset();
  prompts.text.mockReset().mockResolvedValue("ready");
});
afterEach(() => {
  for (const stream of streams.splice(0)) stream.destroy();
  if (previousTTY === undefined) Reflect.deleteProperty(process.stdin, "isTTY");
  else Object.defineProperty(process.stdin, "isTTY", previousTTY);
  process.exitCode = previousExitCode;
});

describe.each([
  { name: "custom TTY over process pipe", processTTY: false, customTTY: true },
  { name: "custom pipe over process TTY", processTTY: true, customTTY: false },
  { name: "custom and process TTY", processTTY: true, customTTY: true },
  { name: "custom and process pipe", processTTY: false, customTTY: false },
  { name: "default process TTY", processTTY: true, customTTY: undefined },
  { name: "default process pipe", processTTY: false, customTTY: undefined }
])("confirmation with $name", ({ processTTY, customTTY }) => {
  describe.each([false, true])("yes=%s", (yes) => {
    describe.each([false, true])("enabled=%s", (enabled) => {
      it.each([
        { name: "accept", answer: true },
        { name: "decline", answer: false },
        { name: "cancel", answer: Symbol.for("poe.cancel") }
      ])("routes $name consistently with parameter prompts", async ({ answer }) => {
        Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: processTTY });
        const input = Object.assign(new PassThrough(), { isTTY: customTTY });
        const output = Object.assign(new PassThrough(), { isTTY: customTTY });
        streams.push(input, output);
        const promptStreams = customTTY === undefined ? {} : { input, output };
        const interactive = (customTTY ?? processTTY) && !yes;
        const shouldConfirm = enabled && interactive;
        prompts.confirm.mockResolvedValue(answer);
        const handler = vi.fn(({ params }: { params: { target: string } }) => params);
        const root = defineGroup({ name: "audit", children: [defineCommand({
          name: "check", confirm: enabled,
          params: S.Object({ target: S.String({ default: "ready" }) }), handler
        })] });
        const emitted: string[] = [];
        await runCLI(root, {
          argv: ["node", "audit", "check", ...(yes ? ["--yes"] : [])],
          controls: { yes: true }, errorReports: false,
          ...(customTTY === undefined ? {} : { promptInput: input, promptOutput: output }),
          outputEmitter: (entry) => emitted.push(entry)
        });
        expect(prompts.text).toHaveBeenCalledTimes(interactive ? 1 : 0);
        if (interactive) expect(prompts.text).toHaveBeenCalledWith({ message: "--target", initialValue: "ready", ...promptStreams });
        expect(prompts.confirm).toHaveBeenCalledTimes(shouldConfirm ? 1 : 0);
        if (shouldConfirm) expect(prompts.confirm).toHaveBeenCalledWith({ message: "Proceed?", initialValue: true, ...promptStreams });
        if (shouldConfirm && answer !== true) {
          expect(process.exitCode).toBe(1);
          expect(handler).not.toHaveBeenCalled();
          expect(emitted.join("\n").split("Operation cancelled.")).toHaveLength(2);
        } else {
          expect(process.exitCode, emitted.join("\n")).toBe(0);
          expect(handler).toHaveBeenCalledOnce();
          expect(handler.mock.calls[0]![0].params).toEqual({ target: "ready" });
        }
      });
    });
  });
});
