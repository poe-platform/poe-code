import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Shell, MemoryFileSystem, CommandRegistry } from "virtual-bash";

const [packageRoot, reportPath] = process.argv.slice(2);
const { createColumnCommands } = await import(pathToFileURL(`${packageRoot}/dist/commands/column/index.js`));
const rows = [];
for (const boundary of ["direct", "Shell"]) {
  for (const style of ["sync", "reject", "zero"]) {
    const reason = style === "zero" ? 0 : new Error(`column-${boundary}-${style}-return`);
    let reads = 0;
    let returns = 0;
    const errors = [];
    const output = [];
    const source = { [Symbol.asyncIterator]() { return {
      async next() { reads++; return { done: false, value: new TextEncoder().encode("a b\n") }; },
      return() { returns++; if (style === "sync") throw reason; return Promise.reject(reason); },
    }; } };
    const definition = createColumnCommands({ limits: { maxInputBytes: 1 } })[0];
    const fs = new MemoryFileSystem();
    const instance = boundary === "Shell" ? new Shell({ fs, commands: new CommandRegistry([definition]) }) : undefined;
    const stdout = { async write(bytes) { output.push(Buffer.from(bytes)); } };
    const stderr = { async write(bytes) { errors.push(Buffer.from(bytes)); } };
    const row = { boundary, style };
    try {
      const operation = instance ? instance.exec("column -t", { stdin: source, stdout, stderr }) : definition.execute({ command: "column", args: ["-t"], stdin: source, stdout, stderr, fs, env: {}, cwd: "/", signal: new AbortController().signal });
      const result = await Promise.resolve(operation).then(value => ({ ok: true, value }), error => ({ ok: false, error }));
      row.observed = { ok: result.ok, exitCode: result.value?.exitCode, reason: String(result.error), sameReturnReason: !result.ok && result.error === reason, reads, returns, stderr: Buffer.concat(errors).toString(), stdoutHex: Buffer.concat(output).toString("hex") };
      assert.equal(reads, 1);
      assert.equal(returns, 1);
      assert.equal(Buffer.concat(output).length, 0);
      assert.equal(Buffer.concat(errors).toString(), "column: input limit exceeded\n");
      if (boundary === "direct") {
        assert.equal(result.ok, true);
        assert.equal(result.value.exitCode, 1);
      } else {
        assert.equal(result.ok, false);
        assert.equal(result.error, reason);
      }
      row.pass = true;
    } catch (error) {
      row.pass = false;
      row.failure = { message: error.message, stack: error.stack };
    } finally { await instance?.dispose(); }
    rows.push(row);
  }
}
writeFileSync(reportPath, JSON.stringify({ label: "post-inspection targeted column supplement, NOT frozen holdouts", rows }, null, 2) + "\n", { flag: "wx" });
assert.ok(rows.every(row => row.pass), JSON.stringify(rows.filter(row => !row.pass)));
