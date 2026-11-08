import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";

vi.mock("toolcraft-design", async (importOriginal) => ({
  ...await importOriginal<typeof import("toolcraft-design")>(),
  promptText: vi.fn(async () => Symbol.for("poe.cancel")),
  select: vi.fn(async () => Symbol.for("poe.cancel")),
  confirm: vi.fn(async () => Symbol.for("poe.cancel"))
}));

const previousExitCode = process.exitCode;
const previousTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const streams: PassThrough[] = [];
beforeEach(() => {
  process.exitCode = 0;
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const stream of streams.splice(0)) stream.destroy();
  if (previousTTY === undefined) Reflect.deleteProperty(process.stdin, "isTTY");
  else Object.defineProperty(process.stdin, "isTTY", previousTTY);
  process.exitCode = previousExitCode;
});

describe.each([false, true])("cancellation with capture=%s", (capture) => {
  describe.each(["rich", "json", "markdown"])("%s output", (format) => {
    it.each([
      { name: "text", params: S.Object({ value: S.String() }), args: [], confirm: false },
      { name: "enum", params: S.Object({ value: S.Enum(["first", "second"]) }), args: [], confirm: false },
      { name: "boolean", params: S.Object({ value: S.Boolean() }), args: [], confirm: false },
      {
        name: "selected variant", params: S.Object({ payload: S.OneOf({
          discriminator: "kind", branches: { first: S.Object({ value: S.String() }) }
        }) }), args: ["--payload.kind", "first"], confirm: false
      },
      {
        name: "variant selector", params: S.Object({ payload: S.OneOf({
          discriminator: "kind", branches: { first: S.Object({ value: S.String() }) }
        }) }), args: [], confirm: false
      },
      { name: "confirmation", params: S.Object({}), args: [], confirm: true }
    ])("routes $name cancellation exactly once", async ({ params, args, confirm }) => {
      const handler = vi.fn(() => "ready");
      const root = defineGroup({ name: "audit", children: [defineCommand({ name: "check", params, confirm, handler })] });
      const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const input = Object.assign(new PassThrough(), { isTTY: true });
      const output = Object.assign(new PassThrough(), { isTTY: true });
      streams.push(input, output);
      const captured: string[] = [];
      await runCLI(root, {
        argv: ["node", "audit", "check", ...args, "--output", format],
        controls: { output: true }, errorReports: false,
        promptInput: input, promptOutput: output,
        ...(capture ? { outputEmitter: (entry: string) => captured.push(entry) } : {})
      });
      const text = capture ? captured.join("\n") : stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(process.exitCode).toBe(1);
      expect(handler).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
      expect(text.split("Operation cancelled.")).toHaveLength(2);
      if (capture) expect(stdout).not.toHaveBeenCalled();
      if (format === "json" && !capture) expect(() => JSON.parse(text)).not.toThrow();
    });
  });

  it("routes missing-value choice cancellation exactly once", async () => {
    const handler = vi.fn(() => "ready");
    const root = defineGroup({ name: "audit", children: [defineCommand({
      name: "check", params: S.Object({ value: S.Optional(S.String({ cli: {
        resolveMissing: async () => ({ choices: [{ label: "First", value: "first" }, { label: "Second", value: "second" }] })
      } })) }), handler
    })] });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    streams.push(input, output);
    const captured: string[] = [];
    await runCLI(root, {
      argv: ["node", "audit", "check"], errorReports: false,
      promptInput: input, promptOutput: output,
      ...(capture ? { outputEmitter: (entry: string) => captured.push(entry) } : {})
    });
    const text = capture ? captured.join("\n") : stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(process.exitCode).toBe(1);
    expect(handler).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    expect(text.split("Operation cancelled.")).toHaveLength(2);
    if (capture) expect(stdout).not.toHaveBeenCalled();
  });
});
