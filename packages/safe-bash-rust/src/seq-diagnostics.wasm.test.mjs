import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {RustWasmBash} from "./index.js";

const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const captured = JSON.parse(await readFile(new URL("../../safe-bash/tests/commands/stream-format/evidence/seq-diagnostic-initial.json", import.meta.url), "utf8"));
for (const runtime of ["TypeScript", "Rust"]) {
  test(`${runtime} seq rejects malformed formats and numeric suffixes`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem} = await import("@poe-platform/safe-bash");
    const {seqCommands} = await import("safe-bash-command-seq");
    const shell = runtime === "TypeScript" ? new Shell({fs: createMemoryFileSystem(), cwd: "/"}).use(seqCommands())
      : new RustWasmBash({cwd: "/", forceNative: true});
    try {
      for (const {args, native} of captured.cases) {
        const result = await shell.exec(`seq ${args.map(quote).join(" ")}`);
        assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes).toString("hex"), result.stderr],
          [native.exitCode, native.stdoutHex, native.stderr], JSON.stringify(args));
      }
      for (const number of ["2", "0x2"]) for (const [whitespace, escaped] of [[" ", " "], ["\t", "\\t"], ["\n", "\\n"], ["\r", "\\r"], ["\v", "\\v"], ["\f", "\\f"]]) {
        const operand = number + whitespace;
        for (const args of [[operand], [operand, "3"], ["1", operand, "3"], ["1", "1", operand]]) {
          const command = `seq ${args.map(quote).join(" ")}`;
          for (const source of [command, `values=$(${command})`]) {
            const result = await shell.exec(source);
            assert.deepEqual([result.exitCode, result.stdout, result.stderr],
              [1, "", `seq: invalid floating point argument: '${number + escaped}'\nTry 'seq --help' for more information.\n`], JSON.stringify(source));
          }
        }
        const result = await shell.exec(`seq ${quote(whitespace + number)}`);
        assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "1\n2\n", ""]);
      }
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}
