import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";

for (const command of ["local", "declare"]) {
  for (const [flag, value, expected] of [["x", "new", 'declare -ax arr=([0]="new")'], ["r", "new", 'declare -ar arr=([0]="new")'], ["i", "2+3", 'declare -ai arr=([0]="5")'], ["l", "NEW", 'declare -al arr=([0]="new")'], ["u", "new", 'declare -au arr=([0]="NEW")']]) {
    test(`${command} -${flag} applies to a shadowed array`, async () => {
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
      assert.equal(result.stdout, `declare -a arr=([0]="MiXeD")\ndeclare -a${flag} arr=([0]="1")\n`);
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
  ['declare -ai arr=(2); f() { local -I arr=3+4; declare -p arr; }; f', 'declare -ai arr=([0]="7")\n'],
  ['arr=(x y); f() { local -x arr; declare -p arr; }; f', 'declare -ax arr=()\n'],
  ['arr=(x y); f() { local -u arr+=new; declare -p arr; }; f', 'declare -au arr=([0]="NEW")\n'],
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
