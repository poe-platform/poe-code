import { test, expect } from "vitest";
import { createSipsCommand, type SipsLimits } from "./index.js";

test("sips validates configured limits and accepts unlimited defaults", () => {
  const limits: Partial<SipsLimits> = { maxInputBytes: 0 };
  expect(() => createSipsCommand({ limits })).not.toThrow();
  expect(() => createSipsCommand({ limits: { maxInputBytes: Infinity } })).not.toThrow();
  for (const value of [-1, NaN, 1.5]) {
    expect(() => createSipsCommand({ limits: { maxInputBytes: value } })).toThrow(RangeError);
  }
});

import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";

test("sips enforces limits on file inputs even when file-probe errors are caught", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in", new Uint8Array(4));
  await expect(createSipsCommand({ limits: { maxInputBytes: 3 } }).execute({
    command: "sips", args: createCommandArguments(['in', '--out', 'out']).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async () => {} }, stderr: { write: async () => {} },
  })).rejects.toThrow(/input byte limit/);
});

import { createSipsCommands, type SipsCommandsOptions } from "./index.js";
import { encodeImage } from "@poe-code/image-ast/portable";

for (const count of [1, 2]) {
  for (const exact of [false, true]) {
    test(`sips checks caller budget across ${count} files (${exact ? "exact" : "exceeded"})`, async () => {
      const png = encodeImage({ width: 1, height: 1, channels: 4, data: new Uint8Array([255, 0, 0, 255]), format: "png", depth: "uchar", space: "srgb", density: 72, hasAlpha: true }, { format: "png" }).data;
      const fs = createMemoryFileSystem();
      await fs.writeFile("/a.png", png);
      await fs.writeFile("/b.png", png);
      const maxBytes = png.length * count - (exact ? 0 : 1);
      const failure = Object.assign(new Error("caller input ceiling exceeded"), { name: "BudgetExceededError" });
      const checks: number[] = [];
      const options: SipsCommandsOptions = {};
      const command = createSipsCommands(options)[0]!;
      const result = command.execute({
        command: command.name, args: createCommandArguments(["-g", "all", ...["a.png", "b.png"].slice(0, count)]).args,
        cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
        inputBudget: { maxBytes, check(bytes) { checks.push(bytes); if (bytes > maxBytes) throw failure; } },
      });
      if (exact) expect((await result).exitCode).toBe(0);
      else await expect(result).rejects.toBe(failure);
      expect(checks.at(-1)).toBe(png.length * count);
    });
  }
}

test("sips propagates filesystem budget failures", async () => {
  const fs = createMemoryFileSystem();
  const failure = Object.assign(new Error("caller input ceiling exceeded"), { name: "BudgetExceededError" });
  const supplied=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="openReadFile")return async()=>{throw failure;};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
  await expect(createSipsCommand().execute({
    command: "sips", args: createCommandArguments(["in.png"]).args, cwd: "/", env: {}, fs:supplied,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async () => {} }, stderr: { write: async () => {} },
  })).rejects.toBe(failure);
});
