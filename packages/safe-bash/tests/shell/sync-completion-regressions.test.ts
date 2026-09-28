import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

const warmup = "true; ".repeat(40);

test("arithmetic fallback does not log to the host console", async t => {
  const log = t.mock.method(console, "log", () => {});
  const { shell } = setup();
  t.after(() => shell.dispose());
  const result = await shell.exec('x=10; { (( a = $x / 2 )); }; say "$a"');
  assert.equal(result.stdout, "5\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(log.mock.calls.length, 0);
});

for (const compound of [
  "{ (( count += 1 )); x=1; x=(1 2); }",
  "if true; then (( count += 1 )); x=1; x=(1 2); fi",
  "case yes in yes) (( count += 1 )); x=1; x=(1 2);; esac",
]) {
  test(`null redirect preserves completed compound effects: ${compound}`, async t => {
    const { shell } = setup();
    t.after(() => shell.dispose());
    const result = await shell.exec(`${warmup}unset x; count=0; ${compound} >/dev/null; say "count=$count:\${x[1]}"`);
    assert.equal(result.stdout, "count=1:2\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

test("null redirect keeps printf array assignment within one filesystem operation", async t => {
  const { shell, commands } = setup({ limits: { maxFileSystemOperations: 1 } });
  for (const command of basicCommands()) commands.register(command);
  t.after(() => shell.dispose());
  const result = await shell.exec(`${warmup}x=(1 2); printf -v x %s 3 >/dev/null; say "\${x[*]}"`);
  assert.equal(result.stdout, "3 2\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  await assert.rejects(shell.exec(': >/dev/null; : >/dev/null'), /maxFileSystemOperations/u);
});

for (const forceAsync of [false, true]) {
  test(`unsupported sync printf format retains the async filesystem budget: ${forceAsync}`, async t => {
    const { shell, commands } = setup({ limits: { maxFileSystemOperations: 4 } });
    for (const command of basicCommands()) commands.register(command);
    if (forceAsync) shell.use((_context, next) => next());
    t.after(() => shell.dispose());
    const result = await shell.exec(`${warmup}x=(1 2); printf -v x %b 3 >/dev/null; say "\${x[*]}"`);
    assert.equal(result.stdout, "3 2\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

for (const [initial, expected] of [
  ["unset arr", "unset"],
  ["arr=outer", "outer"],
  ["arr=(outer tail)", "outer"],
] as const) {
  test(`printf indexed promotion restores a plain local: ${initial}`, async t => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    t.after(() => shell.dispose());
    const result = await shell.exec(`${warmup}${initial}; f() { { local arr; printf -v "arr[0]" %s inner; say "inner=\${arr[0]}"; }; }; f; say "outer=\${arr[0]:-unset}"`);
    assert.equal(result.stdout, `inner=inner\nouter=${expected}\n`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

for (const [command, expected] of [
  ["declare -a arr", "0"],
  ["declare -A arr", "0"],
  ["if false; then :; fi", "1"],
  ["while false; do :; done", "1"],
  ["until true; do :; done", "0"],
  ["for x in; do :; done", "1"],
  ["for ((i=0; i<0; i++)); do :; done", "1"],
  ["case a in b) :;; esac", "1"],
] as const) {
  for (const materialize of ["", "other=(one two); saved=${PIPESTATUS[0]}; "]) {
    test(`PIPESTATUS follows executed commands: ${materialize}${command}`, async t => {
      const { shell } = setup();
      t.after(() => shell.dispose());
      const result = await shell.exec(`${warmup}${materialize}false; ${command}; say "status=$?:ps=\${PIPESTATUS[0]}"`);
      assert.equal(result.stdout, `status=0:ps=${expected}\n`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    });
  }
}
