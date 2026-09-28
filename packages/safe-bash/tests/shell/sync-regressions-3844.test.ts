import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";
import { streamCommands } from "../../src/commands/streams.js";

for (const [name, source, expected] of [
  ["declare unset", 'declare x; declare -p x', 'declare -- x\n'],
  ["typeset unset", 'typeset x; typeset -p x', 'declare -- x\n'],
  ["indexed fallback", 'x=0; declare -a a; a=([0]=$((x+=1)) [1]=$(echo hi | cat)); echo "x=$x a=${a[@]}"', 'x=1 a=1 hi\n'],
  ["warm indexed fallback", 'x=0; a=(seed); a=([0]=$((x+=1)) [1]=$(echo hi | cat)); echo "x=$x a=${a[@]}"', 'x=1 a=1 hi\n'],
  ["warm associative fallback", 'x=0; declare -A a=([seed]=old); a=([k1]=$((x+=1)) [k2]=$(echo hi | cat)); echo "x=$x a=${a[k1]},${a[k2]}"', 'x=1 a=1,hi\n'],
  ["associative fallback", 'x=0; declare -A a; a=([k1]=$((x+=1)) [k2]=$(echo hi | cat)); echo "x=$x a=${a[k1]},${a[k2]}"', 'x=1 a=1,hi\n'],
  ["local export restoration", 'a=0; export x=outer; f() { declare x=inner; export y=1; }; for ((i=$a; i<1; i++)); do f; done; declare -p x; sh -c \'echo sub=$x\'', 'declare -x x="outer"\nsub=outer\n'],
  ["scalar closing bracket", 'v="]a"; echo "${v/[]a]/X}" "${v//[]a]/X}" "${v/[!]]/X}"', 'Xa XX ]X\n'],
  ["array closing bracket", 'arr=("]a" "b"); x="${arr[@]//[]a]/X}"; y="${arr[@]//[!]]/X}"; echo "$x | $y"', 'XX b | ]X X\n'],
  ["compound entry append", 'declare -A a=([foo]=bar); a+=([foo]+=more); echo "${a[foo]}"', 'barmore\n'],
] as const) {
  for (const limits of [{}, { maxExpansionBytes: 65536 }]) {
    test(`issue 3844: ${name}, ${JSON.stringify(limits)}`, async context => {
      const { shell, commands } = setup({ limits });
      for (const command of [...basicCommands(), ...streamCommands()]) commands.register(command);
      context.after(() => shell.dispose());
      const result = await shell.exec(source);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    });
  }
}

test("issue 3844: top-level calls with local declarations stay synchronous", async context => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  context.after(() => shell.dispose());
  const { Runtime } = await import("../../src/shell/runtime.js");
  const simple = Runtime.prototype.simple;
  let asynchronousCalls = 0;
  context.mock.method(Runtime.prototype, "simple", function(this: InstanceType<typeof Runtime>, ...args: Parameters<typeof simple>) {
    if (args[0].words[0]?.plain === "f") asynchronousCalls++;
    return simple.apply(this, args);
  });
  const result = await shell.exec('x=outer; f() { local x=inner; result=$x; }; f; echo "$x:$result"');
  assert.equal(result.stdout, "outer:inner\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(asynchronousCalls, 0);
});

for (const [kind, first, second] of [["a", "0", "1"], ["A", "k1", "k2"]]) {
  test(`issue 3844: ${kind} arithmetic failure evaluates earlier mutation once`, async context => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    context.after(() => shell.dispose());
    const result = await shell.exec(`trap 'echo "$x"' EXIT; x=0; declare -${kind} a; a=([${first}]=$((x+=1)) [${second}]=$((1/0)))`);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /division by 0/);
    assert.equal(result.stdout, "1\n");
  });
}
