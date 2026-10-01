import { test, expect } from "vitest";
import { createMagickCommand, type ImagemagickLimits } from "./index.js";

test("imagemagick validates configured limits and accepts unlimited defaults", () => {
  const limits: Partial<ImagemagickLimits> = { maxInputBytes: 0 };
  expect(() => createMagickCommand({ limits })).not.toThrow();
  expect(() => createMagickCommand({ limits: { maxInputBytes: Infinity } })).not.toThrow();
  for (const value of [-1, NaN, 1.5]) {
    expect(() => createMagickCommand({ limits: { maxInputBytes: value } })).toThrow(RangeError);
  }
});

import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";

test("imagemagick enforces limits on file inputs even when file-probe errors are caught", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in", new Uint8Array(4));
  await expect(createMagickCommand({ limits: { maxInputBytes: 3 } }).execute({
    command: "imagemagick", args: createCommandArguments(['in', 'out']).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async () => {} }, stderr: { write: async () => {} },
  })).rejects.toThrow(/input byte limit/);
});

import { runConvertCli, createImagemagickCommands } from "./index.js";
import type { CommandContext, CommandDefinition } from "safe-bash-contracts/command";

async function imageContext(command: CommandDefinition, argv: string[]) {
  const files = new Map<string, Uint8Array>();
  await runConvertCli(["-size", "1x1", "xc:red", "in.png"], files);
  const png = files.get("in.png")!;
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.png", png);
  const output: Uint8Array[] = [];
  const context: CommandContext = {
    command: command.name, args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
    stdin: (async function* () { yield png.subarray(0, 10); yield png.subarray(10); })(),
    signal: new AbortController().signal,
    stdout: { write: async bytes => { output.push(bytes); } }, stderr: { write: async () => {} },
  };
  return { context, png, output };
}

for (const inputs of [["in.png"], ["png:-"], ["in.png", "png:-"]]) {
  test(`magick checks cumulative caller budget for ${inputs.join(" and ")}`, async () => {
    const command = createMagickCommand();
    const { context, png, output } = await imageContext(command, [...inputs, "png:-"]);
    const total = png.byteLength * inputs.length;
    const checks: number[] = [];
    await expect(command.execute({ ...context, inputBudget: {
      maxBytes: total - 1,
      check(bytes) { checks.push(bytes); if (bytes > total - 1) throw new Error("caller input budget"); },
    } })).rejects.toThrow("caller input budget");
    expect(checks.at(-1)).toBe(total);
    expect(output).toEqual([]);
  });
  test(`magick accepts exact input limits without charging output for ${inputs.join(" and ")}`, async () => {
    const initial = await imageContext(createMagickCommand(), [...inputs, "png:-"]);
    const total = initial.png.byteLength * inputs.length;
    const command = createMagickCommand({ limits: { maxInputBytes: total } });
    const checks: number[] = [];
    expect((await command.execute({ ...initial.context, inputBudget: {
      maxBytes: total,
      check(bytes) { checks.push(bytes); if (bytes > total) throw new Error("caller input budget"); },
    } })).exitCode).toBe(0);
    expect(checks).toContain(total);
    expect(initial.output.length).toBeGreaterThan(0);
  });
}

for (const command of createImagemagickCommands({ limits: { maxInputBytes: 90 } })) {
  test(`${command.name} enforces local file budgets before decoding or output`, async () => {
    const { context, png, output } = await imageContext(command, ["in.png", "png:-"]);
    expect(png.byteLength).toBeGreaterThan(90);
    await expect(command.execute(context)).rejects.toThrow(/input byte limit/);
    expect(output).toEqual([]);
  });
}

test("magick enforces a local budget shared by files and chunked stdin", async () => {
  const initial = await imageContext(createMagickCommand(), ["in.png", "png:-", "png:-"]);
  const command = createMagickCommand({ limits: { maxInputBytes: initial.png.byteLength * 2 - 1 } });
  await expect(command.execute(initial.context)).rejects.toThrow(/input byte limit/);
  expect(initial.output).toEqual([]);
});

test("converts dash-prefixed files after -- and normalizes VFS paths", async () => {
  const command = createMagickCommand();
  const { context, png } = await imageContext(command, ["--", "-in.png", "missing/../out.png"]);
  await context.fs.writeFile("/-in.png", png);
  const result = await command.execute(context);
  expect(result.exitCode).toBe(0);
  expect((await context.fs.readFile("/out.png")).length).toBeGreaterThan(0);
});
test("convert runner treats option-like operands after -- as filenames", async () => {
  const files = new Map<string, Uint8Array>();
  await runConvertCli(["-size", "1x1", "xc:red", "in.png"], files);
  files.set("--help", files.get("in.png")!);
  const result = await runConvertCli(["--", "--help", "out.png"], files);
  expect(result.exitCode).toBe(0);
  expect(files.has("out.png")).toBe(true);
});

for (const command of createImagemagickCommands()) {
  test(`${command.name} propagates caller budget failures from filesystem reads`, async () => {
    const { context } = await imageContext(command, ["in.png", "out.png"]);
    const failure = Object.assign(new Error("caller input ceiling exceeded"), { name: "BudgetExceededError" });
    context.fs.readFile = async () => { throw failure; };
    await expect(command.execute(context)).rejects.toBe(failure);
  });
}
