import assert from "node:assert/strict";
import test from "node:test";
import "../../src/shell/sync-extra-evaluators.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { commCommands } from "../../src/commands/comm/index.js";

for (const input of ["one\ntwo\nthree\n", "one\n"]) {
  for (const operand of ["missing", "directory"]) {
    for (const reverse of [false, true]) {
      test(`comm reads one initial record before ${operand} fails, reversed=${reverse}, input=${JSON.stringify(input)}`, async context => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/records", new TextEncoder().encode(input));
        await fs.mkdir("/directory");
        const shell = new Shell({ fs }).use(standardCommands()).use(commCommands());
        context.after(() => shell.dispose());
        const result = await shell.exec(`exec 3<records
comm ${reverse ? `${operand} -` : `- ${operand}`} <&3 2>/dev/null; rc=$?
IFS= read -ru3 next; printf '%s|%s|<%s>\\n' "$rc" "$?" "$next"`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, reverse ? "1|0|<one>\n" : input === "one\n" ? "1|1|<>\n" : "1|0|<two>\n");
      });
    }
  }
}

for (const [operands, output, status] of [
  ["- empty", "one\ntwo\n", 0],
  ["- -", "one\n\ttwo\n", 1],
] as const) {
  test(`comm ${operands} consumes stdin normally`, async context => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/records", new TextEncoder().encode("one\ntwo\n"));
    await fs.writeFile("/empty", new Uint8Array());
    const shell = new Shell({ fs }).use(standardCommands()).use(commCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`exec 3<records
comm ${operands} <&3 2>/dev/null; rc=$?
IFS= read -ru3 next; printf '%s|%s|<%s>\\n' "$rc" "$?" "$next"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${output}${status}|1|<>\n`);
  });
}

for (const [environment, posix] of [
  ["unset POSIXLY_CORRECT", false],
  ["export POSIXLY_CORRECT=1", true],
  ["export POSIXLY_CORRECT=", true],
  ["unset POSIXLY_CORRECT; POSIXLY_CORRECT=1", false],
] as const) {
  for (const [source, posixOutput, defaultOutput] of [
    ["comm one -1", "a\n\tx\n", undefined],
    ["comm one two -1", undefined, "x\n"],
    ["comm -- one -1", "a\n\tx\n", "a\n\tx\n"],
    ["comm -1 one two", "x\n", "x\n"],
    ["comm --output-delimiter : one -1", "a\n:x\n", undefined],
    ["comm one -1 | cat", "a\n\tx\n", undefined],
    ["comm one two -1 | cat", undefined, "x\n"],
    ["printf 'a\\n' | comm - -1", "a\n\tx\n", undefined],
    ["comm - -1 <<< a", "a\n\tx\n", undefined],
    ["comm - -1 < one", "a\n\tx\n", undefined],
  ] as const) {
    test(`comm operand ordering: ${environment}; ${source}`, async context => {
      const fs = new MemoryFileSystem();
      const shell = new Shell({ fs }).use(standardCommands()).use(commCommands());
      context.after(() => shell.dispose());
      for (const [path, content] of [["/one", "a\n"], ["/two", "x\n"], ["/-1", "x\n"]] as const) {
        await fs.writeFile(path, new TextEncoder().encode(content));
      }
      const expected = posix ? posixOutput : defaultOutput;
      for (const body of [
        source,
        `x=$(${source}); status=$?; printf %s "$x"; exit "$status"`,
        `for ((i=0;i<2;i++)); do x=$(${source}); status=$?; done; printf %s "$x"; exit "$status"`,
      ]) {
        const result = await shell.exec(`${environment}; set -o pipefail; ${body}`);
        assert.equal(result.exitCode, expected === undefined ? 1 : 0, body);
        assert.equal(result.stdout, body === source ? expected ?? "" : (expected ?? "").trimEnd(), body);
        assert.equal(result.stderr, expected === undefined ? "comm: EINVAL: comm requires exactly two files\n".repeat(body.startsWith("for") ? 2 : 1) : "", body);
      }
    });
  }
}
