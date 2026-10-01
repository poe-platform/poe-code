import { createTacCommands } from "../../src/commands/tac/index.js";
import { createStreamFormatCommands } from "../../src/commands/stream-format/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createEncodingCommands } from "../../src/commands/bytes/encoding/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

async function execute(source: string) {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createStreamFormatCommands(), ...createTacCommands(), ...createEncodingCommands()]) });
  try { return await shell.exec(source); } finally { await shell.dispose(); }
}

for (const option of ["-d", "--decode"]) {
  for (const input of ["!!!", "abc", "aGVsbG8="]) {
    test(`base64 ${option} here-string substitution: ${input}`, async () => {
      const direct = await execute(`base64 ${option} <<< '${input}'`);
      const result = await execute(`x=$(base64 ${option} <<< '${input}'); printf 'rc=%s x=<%s>\\n' "$?" "$x"`);
      assert.equal(result.stdout, `rc=${direct.exitCode} x=<${direct.stdout.replace(/\n+$/, "")}>\n`);
      assert.equal(result.stderr, direct.stderr);
      assert.equal(result.exitCode, 0);
    });
  }
  test(`base64 ${option} loop clears stale assignment on invalid input`, async () => {
    const result = await execute(`for s in 'aGVsbG8=' '!!!'; do x=$(base64 ${option} <<< "$s"); done; echo "rc=$? x=$x"`);
    assert.equal(result.stdout, "rc=1 x=\n");
    assert.equal(result.stderr, "base64: invalid input\n");
    assert.equal(result.exitCode, 0);
  });
}

for (const command of ["rev", "tac"]) {
  for (const body of [`echo "a$(${command} <<< 'abc' | tr a-z A-Z)"`, `x=$(${command} <<< "$i" | tr a-z A-Z); echo "$x"`]) {
    test(`external here-string pipeline in loop: ${body}`, async () => {
      const reference = await execute(`i=abc; ${body}; i=def; ${body}`);
      assert.deepEqual(await execute(`for i in abc def; do ${body}; done`), reference);
      assert.equal(reference.stdout, body.startsWith("echo") ? (command === "rev" ? "aCBA\naCBA\n" : "aABC\naABC\n") : (command === "rev" ? "CBA\nFED\n" : "ABC\nDEF\n"));
      assert.equal(reference.stderr, "");
      assert.equal(reference.exitCode, 0);
    });
  }
}

for (const locale of ["C", "C.UTF-8"]) {
  for (const separator of ["\u2003", "\u00a0", " "]) {
    test(`pipeline wc -w substitution: ${locale}, ${JSON.stringify(separator)}`, async () => {
      const command = `printf 'a${separator}b\\n' | wc -w`;
      const direct = await execute(`export LC_ALL=${locale}; ${command}`);
      assert.equal(direct.stdout, locale === "C" && separator !== " " ? "1\n" : "2\n");
      assert.deepEqual(await execute(`export LC_ALL=${locale}; x=$(${command}); echo "$x"`), direct);
      assert.deepEqual(await execute(`export LC_ALL=${locale}; for i in 1 2; do x=$(${command}); echo "$x"; done`), await execute(`export LC_ALL=${locale}; ${command}; ${command}`));
    });
  }
}
