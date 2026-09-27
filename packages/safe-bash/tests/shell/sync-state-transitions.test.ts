import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

async function execute(source: string) {
  const shell = new Shell({ fs: new MemoryFileSystem(), stdin: "" });
  for (const command of basicCommands()) shell.commands.register(command);
  try { return await shell.exec(source, { stdin: "" }); }
  finally { await shell.dispose(); }
}

const wrappers = {
  group: (body: string) => `{ ${body}; }`,
  if: (body: string) => `if true; then ${body}; fi`,
  case: (body: string) => `case yes in yes) ${body};; esac`,
  function: (body: string) => `f() { ${body}; }; f 5 '1+2+3'`,
  eval: (body: string) => `eval '${body}'`,
};
for (const [name, wrap] of Object.entries(wrappers)) {
  for (const [transition, body, expected] of [
    ["positionals", 'shift; (( z = $1 ))', '1:6'],
    ["scalar to array", 'x=1; x=(1 2); z=${x[1]}', '1:2'],
    ["array to scalar", 'x=(1 2); x=3; z=$x', '1:3'],
    ["expression operand", 'y="1+2"; (( z = y + 1 ))', '1:4'],
    ["read array", 'x=(1 2); read x <<< 3; z=$x', '1:3'],
    ["printf array", 'x=(1 2); printf -v x 3; z=$x', '1:3'],
  ] as const) {
    test(`${name} executes prefix once after ${transition}`, async () => {
      const result = await execute(`${"true; ".repeat(40)}${Array.from({ length: 5 }, () => `unset x y z; set -- 5 "1+2+3"; count=0; ${wrap(`(( count += 1 )); ${body}`)}; echo "$count:$z"`).join("; ")}`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, `${expected}\n`.repeat(5));
    });
  }
}
for (const [name, wrap] of Object.entries(wrappers)) {
  test(`${name} preserves output prefix across scalar to array fallback`, async () => {
    const result = await execute(`${"true; ".repeat(40)}unset x; ${wrap("echo prefix; x=1; x=(1 2)")}; echo "\${x[1]}"`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "prefix\n2\n");
  });
}
test("associative arithmetic writes create and replace values", async () => {
  const result = await execute('declare -A m; v=1; k=foo; for i in {1..50}; do (( m[foo] = $v )); (( m[$k] += $v )); done; echo "${m[foo]}"');
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "2\n");
});
test("if condition resumes without repeating its prefix", async () => {
  const result = await execute('for i in {1..50}; do count=0; unset x; if (( count += 1 )); x=1; x=(1 2); then echo "$count:${x[1]}"; fi; done');
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "1:2\n".repeat(50));
});
test("if condition preserves output prefix across fallback", async () => {
  const result = await execute(`${"true; ".repeat(40)}unset x; if echo prefix; x=1; x=(1 2); then echo "\${x[1]}"; else echo wrong; fi`);
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "prefix\n2\n");
});
for (const [condition, tail, expected] of [
  ['echo prefix; x=1; x=(1 2); false', 'then echo wrong; else echo fallback; fi', 'prefix\nfallback\n'],
  ['false; then echo wrong; elif echo prefix; x=1; x=(1 2)', 'then echo "${x[1]}"; else echo wrong; fi', 'prefix\n2\n'],
  ['{ echo prefix; x=1; x=(1 2); }', 'then echo "${x[1]}"; fi', 'prefix\n2\n'],
] as const) {
  test(`if condition resume preserves branch selection: ${condition}`, async () => {
    const result = await execute(`${"true; ".repeat(40)}unset x; if ${condition}; ${tail}`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected);
  });
}
test("break in a compound while condition exits without replay", async () => {
  const result = await execute(`${"true; ".repeat(40)}{ while break; do echo wrong; done; echo done; }`);
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "done\n");
});

test("nested eval calling function resumes without replaying prefix across scalar to array transition", async () => {
  const result = await execute('f() { (( count += 1 )); echo "in-f:$count"; shift; x=1; x=(1 "$1"); z=${x[1]}; }; unset x z; count=0; eval \'echo "in-eval"; f 5 99\'; echo "$count:$z"');
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "in-eval\nin-f:1\n1:99\n");
});

test("compound loops preserve multi-arg unset, export, let, and quoted array expansion", async () => {
    const res = await execute(`
      arr=(foo_1 bar_2 foo_3 baz_4)
      acc=0
      for ((i=1; i<=20; i++)); do
        a=$i
        b=$((i+1))
        unset -v a b
        export EXP_A="v$i" EXP_B="w$i"
        let "acc += i" "last = i * 2"
        s1="\${arr[@]:1:2}"
        s2="\${arr[@]/foo/qux}"
        (( acc += \${#EXP_A} + \${#EXP_B} + \${#s1} + \${#s2} + \${a:-0} + \${b:-0} ))
      done
      echo "$acc:$last:$EXP_A:$EXP_B"
    `);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stderr, "");
    assert.equal(res.stdout, "992:40:v20:w20\n");
});
