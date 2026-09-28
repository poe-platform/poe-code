import { test, expect } from "vitest";
import { createPdftoppmCommand, type PdftoppmLimits } from "./index.js";

test("pdftoppm validates configured limits and accepts unlimited defaults", () => {
  const limits: Partial<PdftoppmLimits> = { maxInputBytes: 0 };
  expect(() => createPdftoppmCommand({ limits })).not.toThrow();
  expect(() => createPdftoppmCommand({ limits: { maxInputBytes: Infinity } })).not.toThrow();
  for (const value of [-1, NaN, 1.5]) {
    expect(() => createPdftoppmCommand({ limits: { maxInputBytes: value } })).toThrow(RangeError);
  }
});

import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";

test("pdftoppm enforces limits on file inputs even when file-probe errors are caught", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in", new Uint8Array(4));
  await expect(createPdftoppmCommand({ limits: { maxInputBytes: 3 } }).execute({
    command: "pdftoppm", args: createCommandArguments(['in', 'out']).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async () => {} }, stderr: { write: async () => {} },
  })).rejects.toThrow(/input byte limit/);
});
