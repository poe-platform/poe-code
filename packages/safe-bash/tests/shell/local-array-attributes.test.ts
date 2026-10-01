import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

for (const command of ["local", "declare"]) {
  for (const [flag, value, expected] of [["x", "new", 'declare -x arr="new"'], ["r", "new", 'declare -r arr="new"'], ["i", "2+3", 'declare -i arr="5"'], ["l", "NEW", 'declare -l arr="new"'], ["u", "new", 'declare -u arr="NEW"']]) {
    test(`${command} -${flag} creates a scalar shadow of an outer array`, async () => {
      const { shell } = setup();
      try {
        const result = await shell.exec(`arr=(x y); f() { ${command} -${flag} arr=${value}; declare -p arr; }; f; declare -p arr`);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, expected + '\ndeclare -a arr=([0]="x" [1]="y")\n');
      } finally { await shell.dispose(); }
    });
  }
}
for (const flag of ["i", "l", "u"]) {
  test(`local clears outer -${flag} and restores it on return`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(`declare -a${flag} arr; arr=(1); f() { local arr=MiXeD; declare -p arr; }; f; declare -p arr`);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `declare -- arr="MiXeD"\ndeclare -a${flag} arr=([0]="1")\n`);
    } finally { await shell.dispose(); }
  });
}
for (const [source, flags, value] of [
  ["readonly arr=9", "arx", "9"],
  [': "${arr:=9}"', "ax", "9"],
  ["(( arr=9 ))", "ax", "9"],
  ["(( arr+=5 ))", "ax", "5"],
  ["(( ++arr ))", "ax", "1"],
  ["let arr=9", "ax", "9"],
  [': "$(( arr=9 ))"', "ax", "9"],
]) {
  test(`allexport promotes scalar array write: ${source}`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(`arr=(); set -a; ${source}; declare -p arr`);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `declare -${flags} arr=([0]="${value}")\n`);
    } finally { await shell.dispose(); }
  });
}
for (const command of ["local", "declare"]) {
  test(`${command} readonly shadow rejects later mutation`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(`arr=(x y); f() { ${command} -r arr=new; arr=changed; }; f`);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("readonly"));
    } finally { await shell.dispose(); }
  });
}
for (const [source, expected] of [
  ['declare -ai arr=(2 4); f() { local -I arr=3+4; declare -p arr; }; f; declare -p arr', 'declare -ai arr=([0]="7" [1]="4")\ndeclare -ai arr=([0]="2" [1]="4")\n'],
  ['arr=(x y); f() { local -x arr; declare -p arr; }; f', 'declare -x arr\n'],
  ['arr=(x y); f() { local -u arr+=new; declare -p arr; }; f', 'declare -u arr="NEW"\n'],
  ['arr=(0 keep); set -a; for n in 1 2; do (( arr+=1 )); done; declare -p arr', 'declare -ax arr=([0]="2" [1]="keep")\n'],
  ['arr=(0 keep); set -a; (( arr[0]=9 )); declare -p arr', 'declare -a arr=([0]="9" [1]="keep")\n'],
  ['declare -A arr=([0]=0 [other]=keep); set -a; (( arr=9 )); declare -p arr', 'declare -Ax arr=(["0"]="9" ["other"]="keep")\n'],
] as const) {
  test(source, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(source);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected);
    } finally { await shell.dispose(); }
  });
}

for (const [name, source] of [
  ["plain local starts as an unset scalar", 'arr=(outer tail); f() { local arr; declare -p arr; arr=inner; declare -p arr; }; f; declare -p arr'],
  ["plain local shadows an associative array with a scalar", 'declare -A map=([key]=outer); f() { local map=inner; declare -p map; }; f; printf "%s\\n" "${map[key]}"'],
  ["plain local array promotion restores the outer binding after loop writes", 'declare -A map=([key]=outer); f() { local map; declare -A map; for ((i=0;i<3;i++)); do map[key]=$i; done; printf "%s\\n" "${map[key]}"; }; f; f; printf "%s\\n" "${map[key]}"'],
  ["inherited associative locals preserve kind and all elements", 'declare -A map=([key]=outer [other]=tail); f() { local -I map=inner; map[key]=changed; printf "%s:%s:%s\\n" "${map[0]}" "${map[key]}" "${map[other]}"; }; f; printf "%s:%s:%s\\n" "${map[0]}" "${map[key]}" "${map[other]}"'],
  ["nested inherited locals restore each binding", 'arr=(outer tail); g() { local -I arr; arr[0]=nested; printf "%s:%s\\n" "${arr[0]}" "${arr[1]}"; }; f() { local arr; declare -a arr=(inner keep); g; printf "%s:%s\\n" "${arr[0]}" "${arr[1]}"; }; f; printf "%s:%s\\n" "${arr[0]}" "${arr[1]}"'],
] as const) {
  test(name, async t => {
    const expected = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.ifError(expected.error);
    assert.equal(expected.status, 0, expected.stderr);
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    t.after(() => shell.dispose());
    const result = await shell.exec(source);
    assert.equal(result.stdout, expected.stdout);
    assert.equal(result.stderr, expected.stderr);
    assert.equal(result.exitCode, expected.status);
  });
}
