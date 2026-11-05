import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command } from "./index.js";

// SQLite 3.51 parseHhMmSs/computeJD round seconds together with the fraction,
// and cap the fraction at .999 before converting to integer milliseconds.
// Without modifiers or a nonzero timezone, %f formats the original seconds.
for (const [input, expected, rounded = expected] of [
  ["2024-01-02 03:04:05.6789", "2024-01-02 03:04:05.679"],
  ["2024-01-02 03:04:05.6784", "2024-01-02 03:04:05.678"],
  ["2024-01-02 03:04:05.6785", "2024-01-02 03:04:05.678", "2024-01-02 03:04:05.679"],
  ["2024-01-02 03:04:00.6785", "2024-01-02 03:04:00.678", "2024-01-02 03:04:00.679"],
  ["2024-01-02 03:04:05.9999", "2024-01-02 03:04:05.999"],
  ["2024-12-31 23:59:59.9999", "2024-12-31 23:59:59.999"],
  ["2024-01-02T03:04:05.6789Z", "2024-01-02 03:04:05.679"],
  ["2024-01-02 03:04:05.6789+02:30", "2024-01-02 00:34:05.679"],
  ["2024-01-02 03:04:05.6785+02:30", "2024-01-02 00:34:05.679"],
  ["2024-01-02 03:04:05.6785-02:30", "2024-01-02 05:34:05.679"],
  ["2024-01-02 03:04:05.6785+00:00", "2024-01-02 03:04:05.678", "2024-01-02 03:04:05.679"],
  ["03:04:05.6789", "2000-01-01 03:04:05.679"],
  ["1969-12-31 23:59:59.6789", "1969-12-31 23:59:59.679"],
  ["2024-01-02 03:04:05.1", "2024-01-02 03:04:05.100"],
  ["2024-01-02 03:04:05", "2024-01-02 03:04:05.000"]
]) {
  test(`sqlite3 converts fractional seconds in ${input}`, async () => {
    const sql = `SELECT strftime('%Y-%m-%d %H:%M:%f', '${input}'),
      strftime('%Y-%m-%d %H:%M:%f', '${input}', '+0 seconds'),
      julianday('${input}') = julianday('${rounded}'),
      datetime('${input}', '+0.321 seconds') = datetime('${rounded}', '+0.321 seconds'),
      time('${input}', '+0.321 seconds') = time('${rounded}', '+0.321 seconds'),
      date('${input}', '+0.321 seconds') = date('${rounded}', '+0.321 seconds'),
      unixepoch('${input}', '+0.321 seconds') = unixepoch('${rounded}', '+0.321 seconds');`;
    const stdin = createBytePipe();
    await stdin.close();
    const stdout = createBytePipe();
    const stderr = createBytePipe();
    const output = collectBytes(stdout.readable, { maxBytes: Infinity });
    const errors = collectBytes(stderr.readable, { maxBytes: Infinity });
    try {
      const result = await createSqlite3Command().execute({
        command: "sqlite3",
        args: createCommandArguments([":memory:", sql]).args,
        stdin: stdin.readable,
        stdout: stdout.writable,
        stderr: stderr.writable,
        fs: createMemoryFileSystem(),
        cwd: "/",
        env: {},
        signal: new AbortController().signal
      });
      assert.equal(result.exitCode, 0);
    } finally {
      await stdout.close();
      await stderr.close();
    }
    assert.equal(Buffer.from(await errors).toString(), "");
    assert.equal(Buffer.from(await output).toString(), `${expected}|${rounded}|1|1|1|1|1\n`);
  });
}
