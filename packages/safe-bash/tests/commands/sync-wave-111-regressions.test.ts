import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createTextProgramCommands } from "../../src/commands/text-programs/index.js";
import { createStructuredCommands } from "../../src/commands/structured/index.js";
import { run } from "./helpers.js";
import { CommandRegistry } from "../../src/contracts/index.js";

async function execute(source: string) {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createTextProgramCommands(), ...createStructuredCommands()]) });
  try { return await shell.exec(source); } finally { await shell.dispose(); }
}

for (const operator of ["/", "%"]) {
  for (const divisor of ["0", "$2"]) {
    for (const body of ["echo \"a$(PIPELINE)\"", "x+=$(PIPELINE)"]) {
      test(`awk zero ${operator} ${divisor}: ${body}`, async () => {
        const pipeline = `echo '1 0' | awk '{ print $1 ${operator} ${divisor} }'`;
        const command = body.replace("PIPELINE", pipeline);
        const direct = await execute(`x=""; ${command}; ${command}; echo "$x"`);
        const loop = await execute(`x=""; for i in 1 2; do ${command}; done; echo "$x"`);
        assert.notEqual(direct.stderr, "");
        assert.deepEqual(loop, direct);
      });
    }
  }
}

for (const value of ["1234567.5", "0.00000123456789", "1.23456789", "-1234567.5", "1000000"]) {
  test(`awk OFMT ${value}`, async () => {
    const pipeline = `printf '%s\\n' '${value}' | awk '{ print $1 + 0 }'`;
    const direct = await execute(pipeline);
    for (const source of [`x=$(${pipeline}); echo "$x"`, `for i in 1 2; do x=$(${pipeline}); done; echo "$x"`]) {
      assert.deepEqual(await execute(source), direct);
    }
  });
}

for (const input of ['["foobar"]', '[]', '"foobar"']) {
  test(`jq contains string on ${input}`, async () => {
    const pipeline = `jq 'contains("foo")' <<< '${input}'`;
    const direct = await execute(`${pipeline}; echo "rc=$?"`);
    const substitution = await execute(`x=$(${pipeline}); s=$?; printf '%s' "$x"; if [ -n "$x" ]; then echo; fi; echo "rc=$s"`);
    assert.deepEqual(substitution, direct);
  });
}

for (const [input, flags, expected] of [
  ["😀a\\n😀b\\n", "-s 1 -w 1", "😀a\n😀b\n"],
  ["😀a\\n😁a\\n", "-w 1", "😀a\n😁a\n"],
  ["x 😀a\\nx 😀b\\n", "-f 1 -s 2 -w 1", "x 😀a\nx 😀b\n"],
  ["😀A\\n😀a\\n", "-i -s 1 -w 1", "😀A\n"],
] as const) {
  test(`uniq Unicode ${flags}`, async () => {
    const pipeline = `printf '${input}' | uniq ${flags}`;
    assert.equal((await execute(pipeline)).stdout, expected);
    for (const source of [`x=$(${pipeline}); echo "$x"`, `for i in 1 2; do x=$(${pipeline}); done; echo "$x"`]) {
      assert.equal((await execute(source)).stdout, expected);
    }
  });
}

for (const expression of ["$1 / $2", "$1 % $2", "$1 / 2", "$1 % 2"]) {
  test(`awk divisor status and later record: ${expression}`, async () => {
    const pipeline = `printf '4 2\\n1 0\\n' | awk '{ print ${expression} }'`;
    const command = `x=$(${pipeline}); s=$?; printf '%s:%s\\n' "$s" "$x"`;
    const direct = await execute(`${command}; ${command}`);
    assert.deepEqual(await execute(`for i in 1 2; do ${command}; done`), direct);
  });
}

test("uniq preserves distinct invalid UTF-8 comparison keys", async () => {
  const result = await run("uniq", ["-s", "1", "-w", "1"], {
    stdin: Uint8Array.of(97, 255, 10, 98, 254, 10),
  });
  assert.deepEqual(result.stdoutBytes, Buffer.from([97, 255, 10, 98, 254, 10]));
});
