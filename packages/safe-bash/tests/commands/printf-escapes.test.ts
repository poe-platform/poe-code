import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { streamCommands } from "../../src/commands/streams.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

async function run(command: string, args: string[], options: { env?: Record<string, string> } = {}) {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()), env: options.env ?? {} });
  try {
    return await shell.exec([command, ...args].map(value => "'" + value.split("'").join("'\\''") + "'").join(" "));
  } finally { await shell.dispose(); }
}

test("printf warns on missing hexadecimal digits while preserving Bash output and status", async () => {
  for (const locale of ["C", "C.UTF-8"]) for (const operand of ["Owned\\x", "Owned\\xGtail", "Owned\\xZ3tail"]) {
    const result = await run("printf", ["%b:END\n", operand], { env: { LC_ALL: locale } });
    assert.equal(result.stdout, `${operand}:END\n`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "printf: missing hex digit for \\x\n");
  }
  const valid = await run("printf", ["%b|%b", "\\x4", "\\x42"]);
  assert.deepEqual(Array.from(valid.stdoutBytes), [4, 124, 66]);
  assert.equal(valid.stderr, "");
  const stopped = await run("printf", ["%b:END", "Owned\\c\\x"]);
  assert.equal(stopped.stdout, "Owned");
  assert.equal(stopped.stderr, "");
});

test("printf hexadecimal warnings preserve redirected bytes and immediate status", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, commands: new CommandRegistry(basicCommands()) });
  try {
    const result = await shell.exec("printf '%b:END\\n' 'Owned\\xGtail' > /selected.bin; result=$?; printf 'STATUS:%s\\n' \"$result\"; exit \"$result\"");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "STATUS:0\n");
    assert.equal(result.stderr, "printf: missing hex digit for \\x\n");
    assert.equal(Buffer.from(await fs.readFile("/selected.bin")).toString(), "Owned\\xGtail:END\n");
    const raw = await shell.exec("printf '%b' $'\\xff\\\\x'");
    assert.deepEqual(Array.from(raw.stdoutBytes), [255, 92, 120]);
    assert.equal(raw.stderr, "printf: missing hex digit for \\x\n");
  } finally { await shell.dispose(); }
});

test("printf converts owned bytes without decoding character or quote output", async () => {
  for (const locale of ["C", "C.UTF-8"]) {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs, commands: new CommandRegistry([...basicCommands(), ...streamCommands()]), env: { LC_ALL: locale } });
    try {
      for (const [escape, first, unicode] of [["\\u03a9", 206, 937], ["\\U0001f433", 240, 128051], ["\\xfe", 254, 254]] as const) {
        // Unicode escapes in the source shell are independent of printf's locale.
        const source = escape === "\\u03a9" ? "Ω" : escape === "\\U0001f433" ? "🐳" : `$'${escape}'`;
        const operand = source.startsWith("$") ? source : `'${source}'`;
        await shell.exec(`printf %s ${operand} > /owned`);
        const result = await shell.exec(`owned=$(cat /owned); printf '%5c|%-3c|%d|%f' "$owned" "$owned" "'$owned" "'$owned" > /selected.bin; cat /selected.bin`);
        const numeric = locale === "C" ? first : unicode;
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.deepEqual(Array.from(result.stdoutBytes), [32, 32, 32, 32, first, 124, first, 32, 32, 124, ...Buffer.from(`${numeric}|${numeric}.000000`)]);
        assert.deepEqual(await fs.readFile("/selected.bin"), result.stdoutBytes);
      }
      const controls = await shell.exec("printf '<%c>|<%c>|<%5c>|%s' A '' '' 'Ω🐳'; encoded=$(printf %q 'Ω🐳'); eval \"set -- $encoded\"; printf '|%s' \"$1\"");
      assert.deepEqual(Array.from(controls.stdoutBytes), Array.from(Buffer.from("<A>|<\0>|<    \0>|Ω🐳|Ω🐳")));
      const bounded = await shell.exec("printf '%1000001c' A");
      assert.notEqual(bounded.exitCode, 0);
      for (const byte of [128, 192, 255]) {
        const result = await shell.exec(`owned=$'\\x${byte.toString(16)}'; encoded=$(printf %q "$owned"); eval "set -- $encoded"; printf 'COUNT:%s\\n' "$#"; printf %s "$1"`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.deepEqual(Array.from(result.stdoutBytes), [...Buffer.from("COUNT:1\n"), byte]);
      }
    } finally { await shell.dispose(); }
  }
});
