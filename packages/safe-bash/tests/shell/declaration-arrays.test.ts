import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { agentCommands, createMemoryFileSystem, Shell } from "../../src/index.js";
import { setup } from "./helpers.js";

for (const listing of ["readonly", "readonly -p"]) {
  for (const [declarations, stdout] of [
    ['ra=(1 2); readonly ra; readonly r=1', 'declare -r r="1"\ndeclare -ar ra=([0]="1" [1]="2")\n'],
    [String.raw`ra=([3]="two words" [8]='"$\' [12]=''); readonly ra; empty=(); readonly empty`, 'declare -ar empty=()\n' + String.raw`declare -ar ra=([3]="two words" [8]="\"\$\\" [12]="")` + "\n"],
  ]) {
    test(`${listing} lists readonly indexed arrays and scalars: ${declarations}`, async context => {
      const { shell } = setup();
      context.after(() => shell.dispose());
      const result = await shell.exec(`${declarations}; ${listing}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, 'declare -r BASHOPTS="globskipdots:patsub_replacement:sourcepath"\ndeclare -r SHELLOPTS="braceexpand:hashall"\n' + stdout);
    });
  }
}

test("readonly array listing preserves pipeline status alongside a readonly scalar", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), cwd: "/work" }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec('ra=(1 2); readonly ra; readonly r=1; readonly -p | grep -c \' r\'; echo "rc=${PIPESTATUS[0]}"');
  assert.equal(result.stdout, "2\nrc=0\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

const controlDeclarations = [
  ['IFS=:; declare -a IFS; v="a:b c"; printf "<%s>" $v; IFS=,; v="d,e f"; printf "<%s>" $v; set -- a b; printf "|%s|" "$*"', '<a:b c><d,e f>|ab|'],
  ['declare -a OPTIND; set -- -ab; getopts ab flag; printf "%s:%s;" "$flag" "$OPTIND"; getopts ab flag; printf "%s:%s;" "$flag" "$OPTIND"', 'a:1;b:2;'],
  ['OPTIND=3; typeset -a OPTIND; declare -p OPTIND', 'declare -ai OPTIND=([0]="3")\n'],
  ['unset OPTIND; declare -a OPTIND; declare -p OPTIND', 'declare -a OPTIND\n'],
  ['f(){ local -a OPTIND; declare -p OPTIND; }; f; printf "%s" "$OPTIND"', 'declare -a OPTIND\n1'],
  ['IFS=:; f(){ local -a IFS; v="a:b c"; printf "<%s>" $v; }; f; v=a:b; printf "<%s>" $v', '<a:b c><a><b>'],
  ['declare -a IFS; read first second <<< "a b"; printf "<%s><%s>" "$first" "$second"', '<a b><>'],
  ['if declare -a OPTIND; then printf accepted; else printf rejected; fi', "accepted"],
  ['if declare -a IFS; then printf accepted; else printf rejected; fi', "accepted"],
  ['if declare -a v; then printf accepted; else printf rejected; fi', "accepted"],
  ['declare -a OPTIND; printf "%s;" "$?"; declare -p OPTIND', '0;declare -ai OPTIND=([0]="1")\n'],
  ['typeset -a IFS; printf "%s;" "$?"; declare -p IFS', "0;declare -a IFS=([0]=$' \\t\\n')\n"],
] as const;

for (const [source, stdout] of controlDeclarations) {
  test(`control variable indexed declaration: ${source}`, async context => {
    const { shell, commands } = setup();
    context.after(() => shell.dispose());
    for (const command of basicCommands()) commands.register(command);
    const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { env: { PATH: process.env.PATH!, LC_ALL: "C" } });
    assert.equal(native.status, 0);
    assert.equal(native.stdout.toString(), stdout);
    assert.equal(native.stderr.toString(), "");
    const result = await shell.exec(source);
    assert.equal(result.exitCode, native.status);
    assert.deepEqual(Buffer.from(result.stdoutBytes), native.stdout);
    assert.deepEqual(Buffer.from(result.stderrBytes), native.stderr);
  });
}

const cases = [
  ["declare -a a='(1 2 3)'; echo ${#a[@]} ${a[1]}", "3 2\n"],
  ["declare -A m='([k]=v)'; echo \"${m[k]}\"", "v\n"],
  ["saved='([2]=\"two words\" \"\" tail)'; typeset -a a=\"$saved\"; printf '<%s>' \"${!a[@]}\" \"${a[@]}\"", "<2><3><4><two words><><tail>"],
  ["saved='([k]=\"two words\" [empty]=\"\")'; typeset -A m=\"$saved\"; printf '<%s>' \"${m[k]}\" \"${m[empty]}\" \"${#m[@]}\"", "<two words><><2>"],
  ["a=(old); declare -a a+='(new tail)'; printf '<%s>' \"${a[@]}\"", "<old><new><tail>"],
  ["declare -A m=([old]=before); declare -A m+='([k]=after)'; printf '<%s>' \"${m[old]}\" \"${m[k]}\"", "<before><after>"],
  ["a=(outer); f(){ local -a a='(inner tail)'; printf '<%s>' \"${a[@]}\"; }; f; printf '<%s>' \"${a[@]}\"", "<inner><tail><outer>"],
  ["word='two words'; declare -a a='(\"$word\" $(printf tail))'; printf '<%s>' \"${a[@]}\"", "<two words><tail>"],
  ["declare -a a='()'; declare -A m='()'; printf '%s:%s' \"${#a[@]}\" \"${#m[@]}\"", "0:0"],
  ["declare value='(1 2)'; declare -a a='plain text'; printf '<%s>' \"$value\" \"${a[@]}\"", "<(1 2)><plain text>"],
  ["declare -a a='(one' b='(one)tail' c=' (one)' d='(one) '; printf '<%s>' \"${a[@]}\" \"${b[@]}\" \"${c[@]}\" \"${d[@]}\"", "<(one><(one)tail>< (one)><(one) >"],
  ["declare -a a=$'(\\xff two)'; printf '<%s>' \"${a[@]}\"", "<\ufffd><two>"],
  ['declare -a a=(x y); printf "<%s>" "${a[@]}"', "<x><y>"],
  ['f(){ local -a a=(x y); printf "<%s>" "${a[@]}"; }; f', "<x><y>"],
  ['readonly -a a=(x y); printf "<%s>" "${a[@]}"', "<x><y>"],
  ['declare -a a=([3]="three words" ""); printf "<%s>" "${a[@]}"', "<three words><>"],
  ['f(){ local a=(x y) b=scalar; printf "<%s>" "${a[@]}" "$b"; }; f', "<x><y><scalar>"],
  ['f(){ local -a a=(x) b=(y); local -a a+=(z); printf "<%s>" "${a[@]}" "${b[@]}"; }; f', "<x><z><y>"],
  ['f(){ local -q a=(${seen:=bad}); }; f; printf "%s" "${seen-unset}"', "unset"],
  ['a=(outer tail); f(){ local -a a=(inner); printf "<%s>" "${a[@]}"; }; f; printf "<%s>" "${a[@]}"', "<inner><outer><tail>"],
  ['a=(outer tail); f(){ local -a a=("${a[@]}"); printf "<%s>" "${a[@]}"; }; f; printf "<%s>" "${a[@]}"', "<outer><tail><outer><tail>"],
  ['a=outer; f(){ declare -a a=(inner); printf "<%s>" "${a[@]}"; }; f; printf "<%s>" "$a"', "<inner><outer>"],
  ['local -a a=(${seen:=bad}); printf "%s" "${seen-unset}"', "unset"],
  ['readonly -a a=(old); a[0]=bad\nprintf "%s" "${a[0]}"', "old"],
  ['declare -ar a=(old); a[0]=bad\nprintf "%s" "${a[0]}"', "old"],
  ["a=($'\\xff'); f(){ local -a a=($'\\xfe' \"two words\" ''); printf '<%s>' \"${a[@]}\"; }; f; printf '<%s>' \"${a[@]}\"", "<\ufffd><two words><><\ufffd>"],
] as const;

for (const [source, stdout] of cases) {
  test(`default indexed declaration: ${source}`, async context => {
    const { shell, commands } = setup();
    context.after(() => shell.dispose());
    for (const command of basicCommands()) commands.register(command);
    const result = await shell.exec(source);
    assert.equal(result.stdout, stdout);
    assert.equal(result.exitCode, 0);
    if (source.includes("seen")) {
      assert.ok(result.stderr.length > 0);
      return;
    }
    const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { env: { PATH: process.env.PATH!, LC_ALL: "C" } });
    assert.equal(native.status, 0);
    assert.deepEqual(Buffer.from(result.stdoutBytes), native.stdout);
  });
}

test("default indexed declarations work in virtual script files", async context => {
  const { shell, commands, fs } = setup();
  context.after(() => shell.dispose());
  for (const command of basicCommands()) commands.register(command);
  await fs.writeFile("/arrays.sh", Buffer.from('declare -a a=(x); f(){ local -a a=(y); printf "<%s>" "${a[@]}"; }; f; readonly -a a+=(z); printf "<%s>" "${a[@]}"'));
  const result = await shell.exec("bash /arrays.sh");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "<y><x><z>");
});
