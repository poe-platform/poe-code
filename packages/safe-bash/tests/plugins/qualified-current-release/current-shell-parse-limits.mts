import assert from "node:assert/strict";
import { Shell, ShellLimitError, cloudflareWorkerLimits, parseShell, type ShellLimits, type ShellParseOptions } from "virtual-bash";
import { MemoryFileSystem } from "poe-code/safe-fs";

const limits: ShellLimits = { maxParseUnits: 32 };
const options: ShellParseOptions = { maxParseUnits: 32 };
const worker: Readonly<Required<ShellLimits>> = cloudflareWorkerLimits;
assert.equal(worker.maxParseUnits, 65_536);
assert.deepEqual(parseShell(":"), parseShell(":", 0));
assert.deepEqual(parseShell(":", 0, options), parseShell(":"));
const parseLimit = (error: unknown): boolean => error instanceof ShellLimitError && error.limit === "maxParseUnits";
assert.throws(() => parseShell(":", 0, { maxParseUnits: 0 }), parseLimit);
const shell = new Shell({ fs: new MemoryFileSystem(), limits });
try {
  assert.equal((await shell.exec(":")).exitCode, 0);
  await assert.rejects(shell.exec(":", { limits: { maxParseUnits: 0 } }), parseLimit);
  assert.equal((await shell.exec(":")).exitCode, 0);
} finally { await shell.dispose(); }
