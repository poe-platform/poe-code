import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { readExtension } from "../../../../src/shell/extensions/read/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { primaryReference } from "./primary-reference.js";

const cases = ["-E value", "-Er -n2 value", "-E -a values", "-E -n0 value", "-E -N3 value", "-E -d: value", "-E -s value", "-E -p ignored value", "-E -i ignored value", "-eE value", "-Ee value", "-EE value", "-t0 -E bad-name", "-u3 -E value 3<&0", "-E -r"];

for (const route of ["buffer", "VFS"] as const) for (const args of cases) {
  test(`declared nonterminal ${route} matches primary bytes and consumption: ${args}`, async context => {
    const program = `value=OLD; values=(KEEP STAY); read ${args}; status=$?; printf 'status=%s value=<%s> reply=<%s> array=<%s>;' "$status" "$value" "$REPLY" "\${values[*]}"; IFS= read -r tail; printf 'tail=%s:<%s>' "$?" "$tail"`;
    const input = "ab: cd\nTAIL\n";
    const expected = primaryReference("nonterminal.test.ts", `[[ -t 0 ]] && exit 97; ${program}`, input);
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs, extensions: [readExtension({ nonTerminalInput: true })] });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    if (route === "VFS") await fs.writeFile("/input", Buffer.from(input));
    const result = await shell.exec(route === "VFS" ? `{ ${program}; } </input` : program, {
      ...(route === "buffer" ? { stdin: Buffer.from(input) } : {}), env: { LC_ALL: "C" },
    });
    assert.equal(result.exitCode, expected.status);
    assert.deepEqual(Buffer.from(result.stdoutBytes), expected.stdout);
    assert.deepEqual(Buffer.from(result.stderrBytes), expected.stderr);
  });
}

for (const declaration of [undefined, false] as const) test(`undeclared terminal mode refuses -E without consuming: ${declaration}`, async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [declaration === undefined ? readExtension() : readExtension({ nonTerminalInput: declaration })] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec("value=OLD; read -E value; printf '%s:<%s>;' \"$?\" \"$value\"; read -r tail; printf '<%s>' \"$tail\"", {
    stdin: { async *[Symbol.asyncIterator]() { yield Buffer.from("first\nsecond\n"); } },
  });
  assert.equal(result.stdout, "1:<OLD>;<first>");
  assert.equal(result.stderr, "shell: line 1: read: -E: terminal input capabilities unavailable through this extension API\n");
});

test("nonterminal declaration does not invent deadline provenance", async context => {
  const failures: unknown[] = [];
  const shell = new Shell({ fs: createMemoryFileSystem(), onInternalError: reason => { failures.push(reason); }, extensions: [readExtension({ nonTerminalInput: true })] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec("read -Et.01 value; printf '%s;' \"$?\"; read -r tail; printf '<%s>' \"$tail\"", {
    stdin: { async *[Symbol.asyncIterator]() { yield Buffer.from("first\n"); } },
  });
  assert.equal(result.stdout, "1;<first>");
  assert.equal(result.stderr, "shell: line 1: internal error\n");
  assert.equal(failures.length, 1);
  assert.ok(failures[0] instanceof TypeError);
  assert.equal(failures[0].message, "Read timeout requires explicit input provenance");
});
