import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";
import { Shell, MemoryFileSystem, agentCommands } from "../../src/index.js";

for (const [source, expected] of [
  ['a=hello; unset -v a; printf \'status=%s,value=<%s>\' "$?" "${a-unset}"', 'status=0,value=<unset>'],
  ['f(){ printf hello; }; unset -f f; r=$?; printf \'status=%s,type=\' "$r"; type -t f || true', 'status=0,type='],
  ['f=value; f(){ printf function; }; unset -v f; printf "%s:%s:" "$?" "${f-unset}"; f', '0:unset:function'],
  ['f=value; f(){ printf function; }; unset -f f; printf "%s:%s:" "$?" "$f"; type -t f || true', '0:value:'],
  ['a=outer; f(){ local a=inner; unset -v a; printf "%s:" "${a-unset}"; }; f; printf %s "$a"', 'unset:outer'],
  ['export a=old; unset -v a; a=new; envget a', '<unset>'],
  ['f(){ printf parent; }; (unset -f f); f', 'parent'],
  ['a=hello; unset -vv -- a; printf "%s:%s" "$?" "${a-unset}"', '0:unset'],
] as const) {
  test(`unset selection options: ${source}`, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}
for (const [name, script, expected] of [
  ["reported variable", 'a=hello; unset -v a; printf \'status=%s,value=<%s>\' "$?" "${a-unset}"', "status=0,value=<unset>"],
  ["reported function", 'f(){ printf hello; }; unset -f f; r=$?; printf \'status=%s,type=\' "$r"; type -t f || true', "status=0,type="],
  ["option terminator", 'a=hello; unset -- a; printf "%s|%s" "$?" "${a-missing}"', "0|missing"],
  ["variable terminator", 'a=hello; unset -v -- a; printf "%s|%s" "$?" "${a-missing}"', "0|missing"],
  ["missing variables", 'unset -v missing another; printf %s "$?"', "0"],
  ["missing functions", 'unset -f missing "bad-name" "a[0]" ""; printf %s "$?"', "0"],
  ["function names after terminator", 'unset -f -- -v; printf %s "$?"', "0"],
  ["readonly variable with same-named function", 'readonly shared=value; shared(){ :; }; unset -f shared; printf "%s|%s|" "$?" "$shared"; type -t shared || true', "0|value|"],
  ["exported variable with same-named function", 'export shared=value; shared(){ :; }; unset -f shared; sh -c \'printf %s "$shared"\'', "value"],
  ["local variable restoration", 'a=outer; f(){ local a=inner; unset -v a; printf "%s|%s|" "$?" "${a-missing}"; }; f; printf %s "$a"', "0|missing|outer"],
  ["subshell function isolation", 'f(){ printf outer; }; (unset -f f; printf "%s|" "$?"; type -t f || true); f', "0|outer"],
  ["executing function removal", 'f(){ unset -f f; printf continued; }; f; type -t f || true', "continued"],
  ["array element", 'a=(one two); a(){ :; }; unset -v "a[0]"; printf "%s|%s|%s|" "$?" "${a[0]}" "${a[1]}"; type -t a', "0||two|function\n"],
  ["whole array", 'a=(one two); a(){ :; }; unset -v a; printf "%s|%s|" "$?" "${#a[@]}"; type -t a', "0|0|function\n"],
  ["array with same-named function", 'a=(one two); a(){ :; }; unset -f a; printf "%s|%s|%s|" "$?" "${a[0]}" "${a[1]}"; type -t a || true', "0|one|two|"],
  ["function selection with array subscript", 'a=(one two); unset -f "a[0]"; printf "%s|%s|%s" "$?" "${a[0]}" "${a[1]}"', "0|one|two"],
  ["local array restoration", 'a=(outer); f(){ local -a a; a[0]=inner; unset -v a; printf "%s|%s|" "$?" "${#a[@]}"; }; f; printf %s "${a[0]}"', "0|0|outer"],
  ["raw associative key offset", 'declare -A m; x=$\'\\377\'; y=$\'\\376\'; m[$x]=first; m[$y]=second; unset -v -v -- "m[$x]"; printf "%s|%s|%s" "$?" "${#m[@]}" "${m[$y]}"', "0|1|second"],
] as const) {
  test("unset preserves " + name, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(script);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  });
}

for (const [options, expected] of [
  ["-v", "0|missing|function\n"],
  ["-vv", "0|missing|function\n"],
  ["-v -v --", "0|missing|function\n"],
  ["-f", "0|value|"],
  ["-ff", "0|value|"],
  ["-f -f --", "0|value|"],
] as const) {
  test("unset " + options + " selects only its own namespace", async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec('shared=value; shared(){ :; }; unset ' + options + ' shared; printf "%s|%s|" "$?" "${shared-missing}"; type -t shared || true');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  });
}

for (const [options, status, diagnostic] of [
  ["-vf", 1, "unset: cannot simultaneously unset a function and a variable\n"],
  ["-fv", 1, "unset: cannot simultaneously unset a function and a variable\n"],
  ["-v -f", 1, "unset: cannot simultaneously unset a function and a variable\n"],
  ["-f -v", 1, "unset: cannot simultaneously unset a function and a variable\n"],
  ["-z", 2, "unset: -z: invalid option\n"],
  ["-vz", 2, "unset: -z: invalid option\n"],
  ["-fvz", 2, "unset: -z: invalid option\n"],
] as const) {
  test("unset " + options + " rejects invalid options before changing bindings", async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec('shared=value; shared(){ :; }; unset ' + options + ' shared; printf "%s|%s|" "$?" "$shared"; type -t shared');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, status + "|value|function\n");
    assert.equal(result.stderr, diagnostic);
  });
}

for (const [operands, diagnostic] of [
  ["a -f b", "unset: -f: not a valid identifier\n"],
  ["- a b", "unset: -: not a valid identifier\n"],
  ["-- -f a b", "unset: -f: not a valid identifier\n"],
] as const) {
  test("unset -v " + operands + " treats options after the terminator or first operand as names", async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec('a=one; b=two; unset -v ' + operands + '; printf "%s|%s|%s" "$?" "${a-missing}" "${b-missing}"');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "1|missing|missing");
    assert.equal(result.stderr, diagnostic);
  });
}

test("unset -v preserves readonly bindings and removes subsequent writable variables", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec('readonly a=keep; b=remove; unset -v a b; printf "%s|%s|%s" "$?" "$a" "${b-missing}"');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "1|keep|missing");
  assert.equal(result.stderr, "shell: line 1: unset: a: cannot unset: readonly variable\n");
});


test("unset -f preserves readonly functions and removes subsequent writable functions", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec('a(){ printf kept; }; b(){ :; }; readonly -f a; unset -f a b; printf "%s|" "$?"; a; type -t b || true');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "1|kept");
  assert.equal(result.stderr, "shell: line 1: unset: a: cannot unset: readonly function\n");
});


test("unset -f clears function export attributes before a later redefinition", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("f(){ :; }; export -f f; unset -f f; f(){ :; }; bash -c 'type -t f'; printf 'status=%s' \"$?\"");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "status=1");
  assert.equal(result.stderr, "");
});
