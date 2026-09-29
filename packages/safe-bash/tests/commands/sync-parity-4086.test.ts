import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createStructuredCommands } from "../../src/commands/structured/index.js";
import { createJoinCommands } from "../../src/commands/join/index.js";
import { createColumnCommands } from "../../src/commands/column/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { Runtime } from "../../src/shell/runtime.js";

async function execute(source: string) {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([
    ...createStandardCommands(), ...createStructuredCommands(), ...createJoinCommands(), ...createColumnCommands(),
  ]) });
  try { return await shell.exec(source); } finally { await shell.dispose(); }
}

for (const [setup, command, expected] of [
  ["", "printf '[1,2]\\n' | jq -c 'select(.[])'", "[1,2]\n[1,2]\n"],
  ["", "printf '[false,null,0,1]\\n' | jq -c 'select(.[])'", "[false,null,0,1]\n[false,null,0,1]\n"],
  ["printf ':x\\n' > f1; printf ':y\\n' > f2;", "join -t : -e EMPTY -o 0,1.2,2.2 f1 f2", "EMPTY:x:y\n"],
  ["", "column -t -e <<< $'   \\na b'", "a  b\n"],
] as const) {
  for (const mode of ["direct", "substitution", "loop"]) {
    test(`${mode}: ${command}`, async () => {
      const body = mode === "direct" ? command : `x=$(${command}); printf '%s\\n' "$x"`;
      const result = await execute(`${setup} ${mode === "loop" ? `for i in 1 2; do ${body}; done` : body}`);
      assert.equal(result.stdout, expected.repeat(mode === "loop" ? 2 : 1));
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    });
  }
}
for (const value of ["1", '"str"', "true", "[1,2]"]) {
  test(`del rejects nested scalar/array: ${value}`, async () => {
    const command = `printf '{"a":${value}}\\n' | jq -c 'del(.a.b)'`;
    const direct = await execute(command);
    assert.equal(direct.exitCode, 5);
    assert.equal(direct.stdout, "");
    for (const wrap of [(body: string) => body, (body: string) => `for i in 1 2; do ${body}; done`]) {
      const result = await execute(wrap(`x=$(${command}); printf '%s:%s\\n' "$?" "$x"`));
      assert.equal(result.stdout, wrap("").startsWith("for") ? "5:\n5:\n" : "5:\n");
      assert.notEqual(result.stderr, "");
    }
  });
}
for (const mutation of ['printf -v s "%s" "$i"', '(( i ? (s=i) : (s=0) ))', '(( !(s=i) ))']) {
  test(`loop invariant admission observes ${mutation}`, async () => {
    const result = await execute(`s=init; for i in 1 2 3; do ${mutation}; out=$(echo "$s" | tr '0-9' 'a-j'); echo "$out"; done`);
    assert.equal(result.stdout, "b\nc\nd\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

test("sync jq select preserves each truthy result", () => {
  const evaluate = Reflect.get(Runtime.prototype, "evalSyncJqPathOps");
  assert.deepEqual(evaluate.call(Runtime.prototype, [1, 2], "select(.[])"), [[1, 2], [1, 2]]);
  assert.deepEqual(evaluate.call(Runtime.prototype, [false, null, 0, 1], "select(.[])"), [[false, null, 0, 1], [false, null, 0, 1]]);
});

test("sync jq declines invalid nested deletion", () => {
  const evaluate = Reflect.get(Runtime.prototype, "evalSyncJqPathOps");
  for (const a of [1, "str", true, [1, 2]]) assert.equal(evaluate.call(Runtime.prototype, { a }, "del(.a.b)"), undefined);
  assert.deepEqual(evaluate.call(Runtime.prototype, { a: { b: 1, c: 2 } }, "del(.a.b)"), [{ a: { c: 2 } }]);
  assert.deepEqual(evaluate.call(Runtime.prototype, { a: null }, "del(.a.b)"), [{ a: null }]);
});

test("sync join replaces an empty explicit join field", () => {
  const evaluate = Reflect.get(Runtime.prototype, "evalSyncJoin");
  const context = { readSyncMemoryLines: () => [":y"] };
  assert.deepEqual(evaluate.call(context, [":x"], ["-t", ":", "-e", "EMPTY", "-o", "0,1.2,2.2", "-", "f2"], "/"), ["EMPTY:x:y"]);
});

test("sync column skips delimiter-only rows and preserves truly empty rows", () => {
  const evaluate = Reflect.get(Runtime.prototype, "evalSyncColumn");
  assert.deepEqual(evaluate.call(Runtime.prototype, ["   ", "a b"], ["-t", "-e"]), ["a  b"]);
  assert.deepEqual(evaluate.call(Runtime.prototype, ["", "a b"], ["-t", "-e"]), ["", "a  b"]);
});
