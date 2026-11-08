import { test, expect } from "vitest";
import { createPdftkCommand, type PdftkLimits } from "./index.js";

test("pdftk validates configured limits and accepts unlimited defaults", () => {
  const limits: Partial<PdftkLimits> = { maxInputBytes: 0 };
  expect(() => createPdftkCommand({ limits })).not.toThrow();
  expect(() => createPdftkCommand({ limits: { maxInputBytes: Infinity } })).not.toThrow();
  for (const value of [-1, NaN, 1.5]) {
    expect(() => createPdftkCommand({ limits: { maxInputBytes: value } })).toThrow(RangeError);
  }
});

import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";

test("pdftk enforces limits on file inputs even when file-probe errors are caught", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in", new Uint8Array(4));
  await expect(createPdftkCommand({ limits: { maxInputBytes: 3 } }).execute({
    command: "pdftk", args: createCommandArguments(['in', 'dump_data']).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async () => {} }, stderr: { write: async () => {} },
  })).rejects.toThrow(/input byte limit/);
});
