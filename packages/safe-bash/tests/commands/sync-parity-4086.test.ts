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
  ["printf 'k A\\n' > f1; printf 'k B\\n' > f2;", "join -o 1.+2 f1 f2", "A\n"],
  ["printf 'k A\\n' > f1; printf 'k B\\n' > f2;", "join -o 2.+2 f1 f2", "B\n"],
  ["printf 'k A\\n' > f1; printf 'k B\\n' > f2;", "join -j 9007199254740992 f1 f2", " k A k B\n"],
  ["printf 'k A\\n' > f1; printf 'k B\\n' > f2;", "join -1 9007199254740992 -2 9007199254740992 f1 f2", " k A k B\n"],
  ["printf 'k A\\n' > f1; printf 'k B\\n' > f2;", "join -o 1.9007199254740992 f1 f2", "\n"],
  ["printf 'k A\\n' > f1; printf 'k B\\n' > f2;", "join -j 18446744073709551615 -j 18446744073709551616 f1 f2", " k A k B\n"],
  ["", "column -t -e <<< $'   \\na b'", "a  b\n"],
  ["", "column -t -e <<< $'\\na b'", "a  b\n"],
  ["", "column -t -L <<< $'\\na b'", "   \na  b\n"],
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

test("sync join accepts positive output fields and declines invalid numbers", () => {
  const evaluate = Reflect.get(Runtime.prototype, "evalSyncJoin");
  const context = { readSyncMemoryLines: () => ["k B"] };
  for (const [format, expected] of [["1.+2", "A"], ["2.+2", "B"], ["0,1.+2,2.2", "k A B"]]) {
    assert.deepEqual(evaluate.call(context, ["k A"], ["-o", format, "-", "f2"], "/"), [expected]);
  }
  for (const file of [1, 2]) {
    for (const field of ["0", "+0", "-2", "++2", "+", "+2x"]) {
      assert.equal(evaluate.call(context, ["k A"], ["-o", `${file}.${field}`, "-", "f2"], "/"), undefined);
    }
  }
});

test("sync join falls back for large field selections", () => {
  const evaluate = Reflect.get(Runtime.prototype, "evalSyncJoin");
  const context = { readSyncMemoryLines: () => ["k B"] };
  for (const args of [
    ["-j", "9007199254740992"], ["-j9007199254740992"],
    ["-1", "9007199254740992"], ["-29007199254740992"],
    ["-o", "1.9007199254740992"], ["-o2.9007199254740992"],
  ]) {
    assert.equal(evaluate.call(context, ["k A"], [...args, "-", "f2"], "/"), undefined);
  }
});

test("join rejects conflicting large fields inside command substitution loops", async () => {
  const result = await execute("printf 'k A\\n' > f1; printf 'k B\\n' > f2; for i in 1 2; do x=$(join -j 9007199254740992 -j 9007199254740993 f1 f2); printf '%s:%s\\n' \"$?\" \"$x\"; done");
  assert.equal(result.stdout, "1:\n1:\n");
  assert.equal(result.stderr, "join: incompatible join fields 9007199254740991, 9007199254740992\n".repeat(2));
  assert.equal(result.exitCode, 0);
});

test("sync column distinguishes header repetition from keeping empty rows", () => {
  const evaluate = Reflect.get(Runtime.prototype, "evalSyncColumn");
  assert.deepEqual(evaluate.call(Runtime.prototype, ["   ", "a b"], ["-t", "-e"]), ["a  b"]);
  assert.deepEqual(evaluate.call(Runtime.prototype, ["", "a b"], ["-t", "-e"]), ["a  b"]);
  assert.deepEqual(evaluate.call(Runtime.prototype, ["", "a b"], ["-t", "-L"]), ["   ", "a  b"]);
  assert.deepEqual(evaluate.call(Runtime.prototype, ["   ", "a b"], ["-t", "-L"]), ["   ", "a  b"]);
});

for (const selector of [" 1", "\t1", "\n1", "\r1", "\v1", "\f1", " 01", " +2"]) {
 for (const flag of ["-j", "-1", "-2", "-a", "-v"]) {
  test(`join quoted numeric operand ${flag} ${JSON.stringify(selector)} falls back consistently`, async () => {
    const second = Number(selector) === 2;
    const left = (flag === "-j" || flag === "-1") && second ? "A k" : "k A";
    const right = (flag === "-j" || flag === "-2") && second ? "B k" : "k B";
    const unpaired = second ? "y Y\n" : "x X\n";
    const expected = flag === "-v" ? unpaired : "k A B\n" + (flag === "-a" ? unpaired : "");
    const setup = `printf '%s\\n' '${left}' 'x X' > f1; printf '%s\\n' '${right}' 'y Y' > f2; field='${selector}';`;
    const command = `join ${flag} "$field" f1 f2`;
    for (const body of [command, `out=$(${command}); printf '%s\\n' "$out"`, `for i in 1 2; do out=$(${command}); printf '%s\\n' "$out"; done`]) {
      const result = await execute(`${setup} ${body}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected.repeat(body.startsWith("for") ? 2 : 1));
    }
    const evaluate = Reflect.get(Runtime.prototype, "evalSyncJoin");
    assert.equal(evaluate.call({}, undefined, [flag, selector, "f1", "f2"], "/"), undefined);
  });
 }
}
