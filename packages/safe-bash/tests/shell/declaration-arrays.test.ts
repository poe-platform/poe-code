import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

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
