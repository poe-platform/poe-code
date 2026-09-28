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
