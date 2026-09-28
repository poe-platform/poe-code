import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

async function execute(source: string) {
  const shell = new Shell({ fs: new MemoryFileSystem() });
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

test("compound loops execute multi-arg array unset, glob array trims, declare/typeset scalars, and assoc/keyed compound assignments synchronously", async () => {
  const res = await execute(`
    arr=(pre_a pre_b pre_c)
    declare -A map=([x]=1)
    acc=0
    for ((i=1; i<=20; i++)); do
      declare dx="a$i" dy="b$i"
      map=([a]="v$i" [b]="w$i")
      map+=([c]="z$i")
      karr=([1]="p$i" [3]="q$i")
      unset "karr[1]" "map[b]"
      s1="\${arr[@]#pre_}"
      s2="\${arr[@]%_*}"
      (( acc += \${#dx} + \${#dy} + \${#map[@]} + \${#karr[@]} + \${#s1} + \${#s2} ))
    done
    echo "$acc:\${map[a]}:\${map[c]}:\${karr[3]}"
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stderr, "");
  assert.equal(res.stdout, "482:v20:z20:q20\n");
});

test("local += append clears outer variable unless already local or prefixed, and declare -a/-A compound initializers run synchronously", async () => {
  const res = await execute(`
    s="global"
    f1() { local s+="sub"; echo "f1:$s"; }
    f2() { local s="loc"; local s+="sub"; echo "f2:$s"; }
    f3() { s="pref" local s+="sub"; echo "f3:$s"; }
    f1; echo "after_f1:$s"
    f2; echo "after_f2:$s"
    f3; echo "after_f3:$s"
    acc=0
    for ((i=1; i<=15; i++)); do
      declare -a arr=("a$i" "b$i")
      declare -A map=([k1]="v$i" [k2]="w$i")
      declare s+="x"
      (( acc += \${#arr[1]} + \${#map[k2]} + \${#s} ))
    done
    echo "acc:$acc:s:$s"
  `);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stderr, "");
  assert.equal(
    res.stdout,
    "f1:sub\nafter_f1:global\nf2:locsub\nafter_f2:global\nf3:prefsub\nafter_f3:global\nacc:282:s:globalxxxxxxxxxxxxxxx\n"
  );
});

for (const redirect of ["", " 2>/dev/null"]) {
  for (const [label, prefix, name, expected] of [
    ["lazy pipeline status", "true | false", "PIPESTATUS[1]", 0],
    ["missing pipeline status", "true | false", "PIPESTATUS[2]", 1],
    ["pipeline arithmetic selector", "true | false", "PIPESTATUS[1+0]", 0],
    ["directory stack", "true", "DIRSTACK", 0],
    ["directory stack zero", "true", "DIRSTACK[0]", 0],
    ["directory stack members", "true", "DIRSTACK[@]", 0],
    ["missing directory stack", "true", "DIRSTACK[1]", 1],
    ["directory arithmetic selector", "true", "DIRSTACK[1-1]", 0],
    ["directory relative selector", "true", "DIRSTACK[-1]", 0],
    ["associative members at", "declare -A a=([k]=v)", "a[@]", 0],
    ["associative members star", "declare -A a=([k]=v)", "a[*]", 0],
    ["empty associative members", "declare -A a=()", "a[@]", 1],
    ["empty associative star", "declare -A a=()", "a[*]", 1],
    ["associative zero", "declare -A a=([0]='')", "a", 0],
    ["associative missing zero", "declare -A a=([k]=v)", "a", 1],
    ["indexed sparse members", "a=([3]='')", "a[@]", 0],
    ["indexed missing zero", "a=([3]=v)", "a", 1],
    ["scalar zero", "a=''", "a[0]", 0],
    ["scalar missing element", "a=v", "a[1]", 1],
    ["unset members", "unset a", "a[@]", 1],
    ["function outside function", "true", "FUNCNAME[0]", 1],
  ] as const) {
    test(`variable presence: ${label}${redirect}`, async () => {
      const result = await execute(`${prefix}; [[ -v ${name} ]]${redirect}; echo $?`);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `${expected}\n`);
    });
  }
  test(`variable presence: nested function${redirect}`, async () => {
    const result = await execute(`g() { f() { [[ -v FUNCNAME[1] ]]${redirect}; echo $?; }; f; }; g`);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "0\n");
  });
  test(`variable presence: nested function arithmetic${redirect}`, async () => {
    const result = await execute(`g() { f() { [[ -v FUNCNAME[1+0] ]]${redirect}; echo $?; }; f; }; g`);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "0\n");
  });
  test(`variable presence: directory stack follows pushd and popd${redirect}`, async () => {
    const result = await execute(`echo "\${DIRSTACK[0]}"; pushd / >/dev/null; [[ -v DIRSTACK[1] ]]${redirect}; echo $?; popd >/dev/null; [[ -v DIRSTACK[1] ]]${redirect}; echo $?`);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "/\n0\n1\n");
  });
}
