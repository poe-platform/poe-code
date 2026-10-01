import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { Runtime } from "../../src/shell/runtime.js";
import { setup } from "./helpers.js";

const accumulation = `
  for ((i=0; i<20; i++)); do
    k="k_$((i % 5))"
    prev="\${map[$k]:-0}"
    map[$k]=$((prev + i))
    arr+=("item_$i")
  done
  printf '%s\\n' "\${map[k_0]}" "\${map[k_4]}" "\${#arr[@]}" "\${arr[19]}"
`;

for (const inFunction of [false, true]) {
  test(`associative accumulation executes the optimized arithmetic loop: function=${inFunction}`, async t => {
    const runtime = Runtime.prototype as unknown as { runSyncArithForFallback(...args: unknown[]): unknown };
    const loop = t.mock.method(runtime, "runSyncArithForFallback");
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    t.after(() => shell.dispose());
    const result = await shell.exec(`declare -A map; arr=(); ${inFunction ? `f() { ${accumulation} }; f` : accumulation}`);
    assert.equal(result.stdout, "30\n46\n20\nitem_19\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.ok(loop.mock.calls.length > 0, "the public shell entry must reach the optimized loop");
  });
}

for (const header of ["i=start;i<2;i++", "i=0;i<stop;i++", "i=0;i<2;i+=step", "i=0;i<2;i++"]) {
  test(`array bindings in arithmetic headers use normal evaluation: ${header}`, async t => {
    const source = `start=(0); stop=(2); step=(1); ${header === "i=0;i<2;i++" ? "i=(0);" : ""} declare -A map; for ((${header})); do map[key]=$i; done; printf '%s\\n' "\${map[key]}" "$i"`;
    const expected = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.ifError(expected.error);
    const runtime = Runtime.prototype as unknown as { runSyncArithForFallback(...args: unknown[]): unknown };
    const loop = t.mock.method(runtime, "runSyncArithForFallback");
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    t.after(() => shell.dispose());
    const result = await shell.exec(source);
    assert.equal(result.stdout, expected.stdout);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, expected.status);
    assert.equal(loop.mock.calls.length, 0);
  });
}

for (const body of [
  'local -A map; for ((i=0;i<3;i++)); do map[key]=$i; done; printf "%s\\n" "${map[key]}"',
  'local map; declare -A map; for ((i=0;i<3;i++)); do map[key]=$i; done; printf "%s\\n" "${map[key]}"',
]) {
  test(`local array restoration survives loop writes: ${body}`, async t => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    t.after(() => shell.dispose());
    const result = await shell.exec(`declare -A map=([key]=outer); f() { ${body}; }; f; printf '%s\\n' "\${map[key]}"`);
    assert.equal(result.stdout, "2\nouter\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

for (const [name, body] of [
  ["substituted key", 'map[$(printf "k_%s" "$i")]=$i'],
  ["empty key", 'k=""; map[$k]=$i'],
  ["key becomes empty", 'map[$k]=$i; k=""'],
  ["pattern key becomes empty", 'k="${k#?}"; map[$k]=$i'],
  ["arithmetic key side effect", 'map[$((n++))]=$i'],
  ["substituted value", 'map[$k]=$(printf "%s" "$i")'],
  ["growing key", `map[$k]=$i; k="$k${"x".repeat(2048)}"`],
] as const) {
  for (const inFunction of [false, true]) {
    test(`array loop preserves Bash effects and diagnostics: ${name}, function=${inFunction}`, async t => {
      const code = `declare -A map; k=abc; n=0; for ((i=0;i<3;i++)); do printf 'before:%s\\n' "$i"; ${body}; done; printf 'after:%s:%s:%s\\n' "$n" "\${map[k_2]}" "\${map[abc]}"`;
      const source = inFunction ? `f() { ${code}; }; f` : code;
      const expected = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
      assert.ifError(expected.error);
      const { shell, commands } = setup();
      for (const command of basicCommands()) commands.register(command);
      t.after(() => shell.dispose());
      const result = await shell.exec(source);
      assert.equal(result.stdout, expected.stdout);
      assert.equal(result.exitCode, expected.status);
      assert.equal(Boolean(result.stderr), Boolean(expected.stderr));
      if (expected.stderr.includes("bad array subscript")) assert.ok(result.stderr.includes("bad array subscript"), result.stderr);
    });
  }
  test(`assignment-only loop declines unsupported ${name} before execution`, async t => {
    const source = `declare -A map; arr=(); k=abc; n=0; for ((i=0;i<3;i++)); do arr+=("$i"); ${body}; done; printf '%s\\n' "\${arr[*]}" "$n" "\${map[$k]}"`;
    const expected = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.ifError(expected.error);
    const runtime = Runtime.prototype as unknown as { runSyncArithForFallback(...args: unknown[]): unknown };
    const loop = t.mock.method(runtime, "runSyncArithForFallback");
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    t.after(() => shell.dispose());
    const result = await shell.exec(source);
    assert.equal(result.stdout, expected.stdout);
    assert.equal(result.exitCode, expected.status);
    assert.equal(Boolean(result.stderr), Boolean(expected.stderr));
    assert.equal(loop.mock.calls.length, 0);
    if (expected.stderr.includes("bad array subscript")) assert.ok(result.stderr.includes("bad array subscript"), result.stderr);
  });
}

for (const index of ["key", "$k", '"$k"', "key_$i", "$((i+1))"]) {
  test(`nonempty associative keys execute synchronously: ${index}`, async t => {
    const { shell } = setup();
    t.after(() => shell.dispose());
    const runtime = Runtime.prototype as unknown as { runSyncArithForFallback(...args: unknown[]): unknown };
    const loop = t.mock.method(runtime, "runSyncArithForFallback");
    const result = await shell.exec(`declare -A map; k=key; for ((i=0;i<3;i++)); do map[${index}]=$i; done; say "\${map[key]}|\${map[key_2]}|\${map[3]}"`);
    assert.equal(result.stdout, index.includes("i+1") ? "||2\n" : index.includes("$i") ? "|2|\n" : "2||\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.ok(loop.mock.calls.length > 0);
  });
}

test("a declined array write cannot be silently skipped inside an admitted loop", async t => {
  const { shell } = setup();
  t.after(() => shell.dispose());
  const runtime = Runtime.prototype as unknown as { tryFastArrayAssignmentSync(assignment: { kind: string }, ...args: unknown[]): boolean };
  const original = runtime.tryFastArrayAssignmentSync;
  t.mock.method(runtime, "tryFastArrayAssignmentSync", function (this: typeof runtime, assignment: { kind: string }, ...args: unknown[]) {
    return assignment.kind === "element" ? false : original.call(this, assignment, ...args);
  });
  await assert.rejects(shell.exec('declare -A map; for ((i=0;i<3;i++)); do map[key]=$i; done; say after'), /Synchronous loop array assignment was not executable/);
});

for (const parameter of ["_", "LINENO", "FUNCNAME", "DIRSTACK", "BASH_SUBSHELL"]) {
  test(`special parameter ${parameter} retains normal loop expansion`, async t => {
    const { shell } = setup();
    t.after(() => shell.dispose());
    const runtime = Runtime.prototype as unknown as { runSyncArithForFallback(...args: unknown[]): unknown };
    const loop = t.mock.method(runtime, "runSyncArithForFallback");
    const result = await shell.exec(`declare -A map; f() { for ((i=0;i<3;i++)); do map[key]=$${parameter}; done; }; f; say done`);
    assert.equal(result.stdout, "done\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(loop.mock.calls.length, 0);
  });
}

test("indexed append at the fast index ceiling uses normal assignment handling", async t => {
  const source = 'declare -A map; arr=([2147483647]=last); for ((i=0;i<2;i++)); do map[key]=$i; arr+=("$i"); done';
  const runtime = Runtime.prototype as unknown as { runSyncArithForFallback(...args: unknown[]): unknown };
  const loop = t.mock.method(runtime, "runSyncArithForFallback");
  const { shell } = setup();
  t.after(() => shell.dispose());
  const result = await shell.exec(source);
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("index outside 0..2147483647"), result.stderr);
  assert.equal(loop.mock.calls.length, 0);
});
