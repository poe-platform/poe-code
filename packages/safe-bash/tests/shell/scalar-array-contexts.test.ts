import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";
import { nativeOptions, runNative } from "./extensions/trap/oracle.js";

// Scalar star joining and new integer attributes follow Bash 5.2, not macOS Bash 3.2.
const cases = [
  ['IFS=:; set -- one two three; y="$@"; z=$@; printf "<%s>" "$y" "$z"; case "$@" in "one two three") printf space;; *) printf wrong;; esac; [[ "$@" == "one two three" ]]; printf "cond=%s" "$?"; read -r r <<< "$@"; printf "<%s>" "$r"', '<one two three><one two three>spacecond=0<one two three>'],
  ['IFS=""; set -- one two three; y="$@"; z=$@; printf "<%s>" "$y" "$z"', '<one two three><one two three>'],
  ['IFS=:; arr=(one two three); x=${arr[*]}; printf "<%s>" "$x"; [[ ${arr[*]} == "one two three" ]]; printf "cond=%s" "$?"; case ${arr[*]} in "one two three") printf space;; "one:two:three") printf colon;; *) printf wrong;; esac; read -r r <<< ${arr[*]}; printf "<%s>" "$r"', '<one:two:three>cond=1colon<one:two:three>'],
  ['IFS=""; arr=(one two three); x=${arr[*]}; y="${arr[*]}"; printf "<%s>" "$x" "$y"', '<onetwothree><onetwothree>'],
  ['arr=(a b); while read -d "${arr[@]}" x; do printf "b=<%s> x=<%s>" "$b" "$x"; break; done <<< "hello_a_world"', 'b=<hello_> x=<>'],
  ['HOME=/h; arr=([0]=~/a:~/b [1]=foo:~/b); printf "<%s>" "${arr[0]}" "${arr[1]}"', '</h/a:/h/b><foo:/h/b>'],
  ['declare -ia arr=([0]=10 [0]+=5); printf "<%s>" "${arr[0]}"', '<15>'],
  ['declare -ia arr; arr=([0]=10 [0]+=5); printf "<%s>" "${arr[0]}"', '<15>'],
  ['declare -ia arr=([0]=10 [0]+=5); arr[0]+=2; printf "<%s>" "${arr[0]}"', '<17>'],
  ['HOME=/h; arr=([0]=~/a:~/b$(printf suffix) [1]=foo:~/b$(printf suffix)); printf "<%s>" "${arr[0]}" "${arr[1]}"', '</h/a:/h/bsuffix><foo:/h/bsuffix>'],
  ['declare -ia arr=([0]=$(printf 10) [0]+=5); printf "<%s>" "${arr[0]}"', '<15>'],
  ['declare -ia arr; arr=([0]=$(printf 10) [0]+=5); printf "<%s>" "${arr[0]}"', '<15>'],
] as const;

for (const [source, stdout] of cases) {
  for (const bounded of [false, true]) {
    test(`scalar/compound array parity (${bounded ? "bounded" : "unbounded"}): ${source}`, async context => {
      const { shell, commands } = setup(bounded ? { limits: { maxExpansionBytes: 1024 * 1024 } } : {});
      context.after(() => shell.dispose());
      for (const command of basicCommands()) commands.register(command);
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, stdout);
      assert.equal(result.stderr, "");
    });
  }
  test(`pinned Bash 5.2 scalar/compound oracle: ${source}`, nativeOptions(), () => {
    const native = runNative(source);
    assert.equal(native.status, 0, native.stderr.toString());
    assert.equal(native.stdout.toString(), stdout);
    assert.equal(native.stderr.toString(), "");
  });
}
