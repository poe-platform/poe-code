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
