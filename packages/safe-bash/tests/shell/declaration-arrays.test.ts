import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

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
