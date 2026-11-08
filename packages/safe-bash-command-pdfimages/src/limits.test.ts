import { test, expect } from "vitest";
import { createPdfimagesCommand, type PdfimagesLimits } from "./index.js";

test("pdfimages validates configured limits and accepts unlimited defaults", () => {
  const limits: Partial<PdfimagesLimits> = { maxInputBytes: 0 };
  expect(() => createPdfimagesCommand({ limits })).not.toThrow();
  expect(() => createPdfimagesCommand({ limits: { maxInputBytes: Infinity } })).not.toThrow();
  for (const value of [-1, NaN, 1.5]) {
    expect(() => createPdfimagesCommand({ limits: { maxInputBytes: value } })).toThrow(RangeError);
  }
});

import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";

test("pdfimages enforces limits on file inputs even when file-probe errors are caught", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in", new Uint8Array(4));
  await expect(createPdfimagesCommand({ limits: { maxInputBytes: 3 } }).execute({
    command: "pdfimages", args: createCommandArguments(['in', 'out']).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async () => {} }, stderr: { write: async () => {} },
  })).rejects.toThrow(/input byte limit/);
});
