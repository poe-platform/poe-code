import { createStreamFormatCommands } from "../../src/commands/stream-format/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { run } from "./helpers.js";

const cases = [
  ["Unicode case", "É\né\nA\na\n", "uniq -i", "É\né\nA"],
  ["Unicode long case flag", "É\né\n", "uniq --ignore-case", "É\né"],
  ["C width", "éa\néb\n", "LC_ALL=C uniq -w 2", "éa"],
  ["POSIX skip", "éa\nêb\n", "LC_ALL=POSIX uniq -s 2", "éa\nêb"],
  ["ctype width", "éa\néb\n", "LC_CTYPE=C uniq -w 2", "éa"],
  ["lang width", "éa\néb\n", "LANG=C uniq -w 2", "éa"],
  ["locale precedence", "éa\néb\n", "LC_ALL=C.UTF-8 LC_CTYPE=C uniq -w 2", "éa\néb"],
  ["separator bytes", "a\n\nb\n", "nl -s '—'", "     1—a\n         \n     2—b"],
  ["astral separator bytes", "a\n", "nl -bn -s '😀'", "          a"],
] as const;

for (const locale of ["", "export LC_ALL=C; "]) {
  for (const [name, input, filter, expected] of cases) {
    for (const mode of ["pipeline", "substitution", "loop", "arithmetic-loop"] as const) {
      test(`${name}: ${mode}: ${locale || "default locale"}`, async () => {
        const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createStreamFormatCommands()]) });
        try {
          const pipeline = `printf '%s' '${input}' | ${filter}`;
          const body = mode === "pipeline" ? pipeline : mode === "substitution"
            ? `out=$(${pipeline}); printf '%s\\n' "$out"`
            : mode === "loop" ? `for i in 1 2; do out=$(${pipeline}); done; printf '%s\\n' "$out"`
            : `for ((i=0;i<3;i++)); do out=$(${pipeline}); done; printf '%s\\n' "$out"`;
          const result = await shell.exec(`${locale}${body}`);
          assert.equal(result.stdout, `${expected}\n`);
          assert.equal(result.stderr, "");
          assert.equal(result.exitCode, 0);
        } finally { await shell.dispose(); }
      });
    }
  }

}

for (const spec of ["1,2-3-4", "2-3-4", "1,2--3"]) {
  test(`cut rejects malformed range ${spec}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createStreamFormatCommands()]) });
    try {
      const result = await shell.exec(`printf 'a\\tb\\tc\\n' | cut -f${spec}`);
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /invalid range/);
    } finally { await shell.dispose(); }
  });
}

test("cut sync stdin rejects a multi-dash item after a valid field", async () => {
  const bytes = new TextEncoder().encode("a\tb\tc\n");
  let consumed = false;
  const next = (): IteratorResult<Uint8Array> => {
    if (consumed) return { done: true, value: undefined };
    consumed = true;
    return { done: false, value: bytes };
  };
  const stdin = {
    tryReadAllSync: () => bytes,
    [Symbol.asyncIterator]: () => ({ next: async () => next(), tryNextSync: next }),
  };
  const result = await run("cut", ["-f1,2-3-4"], { stdin, commands: createStandardCommands() });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /invalid range/);
});
