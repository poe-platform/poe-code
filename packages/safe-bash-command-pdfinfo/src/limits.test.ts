import assert from "node:assert/strict";
import test from "node:test";
import { createPdfinfoCommand, type PdfinfoLimits } from "./index.js";

test("pdfinfo validates configured limits and accepts unlimited defaults", () => {
  const limits: Partial<PdfinfoLimits> = { maxInputBytes: 0 };
  assert.doesNotThrow(() => createPdfinfoCommand({ limits }));
  assert.doesNotThrow(() => createPdfinfoCommand({ limits: { maxInputBytes: Infinity } }));
  for (const value of [-1, NaN, 1.5]) {
    assert.throws(() => createPdfinfoCommand({ limits: { maxInputBytes: value } }), RangeError);
  }
});

import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";

test("pdfinfo enforces limits on file inputs even when file-probe errors are caught", async t => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in", new Uint8Array(4));
  await assert.rejects(async () => await createPdfinfoCommand({ limits: { maxInputBytes: 3 } }).execute({
    command: "pdfinfo", args: createCommandArguments(['in']).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async () => {} }, stderr: { write: async () => {} },
  }), /input byte limit/);
});
