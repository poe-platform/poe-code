import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";

const sources = [
  'x=0; echo "$((x+=10))_${y:-fallback}"; echo "final x=$x"',
  'x=0; echo "$((++x))" "${y:-fallback}"; echo "final x=$x"',
  'x=0; echo "$((++x))" {a,b}; echo "final x=$x"',
  'x=0; echo "$((x++))_${y:-fallback}"; echo "final x=$x"',
  'x=0; echo "$((x=1))_${y:-fallback}"; echo "final x=$x"',
  'x=0; n="x+=10"; echo "$((n))_${y:-fallback}"; echo "final x=$x"',
  'shopt -s xpg_echo; echo "$(echo "a\\\\nb")"',
  'shopt -s xpg_echo; echo -E "$(echo "a\\\\nb")"; echo -E "a\\\\nb"; shopt -u xpg_echo; echo "a\\\\nb"',
  'shopt -s xpg_echo; echo "$(echo "a\\\\nb" | cat)"',
  'shopt -s xpg_echo; { echo "a\\\\nb" >&3; } 3>&1',
  'shopt -s xpg_echo; command echo "a\\\\nb"; builtin echo "a\\\\nb"; env echo "a\\\\nb"',
  'shopt -s xpg_echo; for i in 1 2 3; do echo "a\\\\nb"; done',
  'shopt -s xpg_echo; (shopt -u xpg_echo; echo "a\\\\nb"); echo "a\\\\nb"',
  'f() { echo "a\\\\nb"; }; f; shopt -s xpg_echo; f; shopt -u xpg_echo; f',
  'i=0; x=$((i++))$(cat /dev/null); echo "x=$x i=$i"',
  'i=0; [[ "$((i++))" =~ ^0$ ]]; echo "status=$? i=$i"',
  'pat="[a-z]*"; i=0; case $((i++)) in $pat) echo wrong;; 0) echo "zero:$i";; 1) echo "one:$i";; esac',
  'i=0; while IFS=$((i++)) read -r a; do printf "a=%s i=%s\\n" "$a" "$i"; done <<< $\'hello\\nworld\'; echo "final i=$i"',
  'false; z="$? $(echo hi)$(cat /dev/null)"; echo "z=[$z]"',
  'false; printf "%s:%s:%s\\n" "$?" "$(echo hi)" "$(cat /dev/null)"',
  'false; [[ "$?$(echo hi)" =~ ^1hi$ ]]; echo "$?"',
  'false; case "$?$(echo hi)" in [a-z]*) echo wrong;; 1hi) echo right;; esac',
  'x="i=99"; i=0; y=$(echo $(( $x ))); echo "y=$y i=$i"',
  'x="i++"; i=0; y=$(echo $(( $x ))); echo "y=$y i=$i"',
  'x="1 / 0"; y="before"; y="prefix:$(echo $(( $x ))):suffix"; printf "status=%s y=[%s]\\n" "$?" "$y"',
  'f() { echo $(( $1 )); }; i=0; y=$(f "i=99"); echo "y=$y i=$i"',
  'f() { echo $(( $1 )); }; y="prefix:$(f "1 / 0"):suffix"; printf "status=%s y=[%s]\\n" "$?" "$y"',
  'y="prefix:$(echo $((1 / 0))):suffix"; printf "status=%s y=[%s]\\n" "$?" "$y"',
  'for i in 1 2; do echo "$(echo "$i")"; done',
  'x="éabc"; echo "${#x}:${x/a/z}"; [[ abc =~ abc ]]; echo "$?"',
  'LC_ALL=C; x="éabc"; echo "${#x}:${x/a/z}"',
];

for (const body of sources) for (const portable of [false, true]) for (const wrap of [
  (source: string) => source,
  (source: string) => `for iteration in 1 2; do ${source}; done`,
  (source: string) => `run() { ${source}; }; run`,
]) {
  const source = wrap(body);
  test(`speculative expansion matches Bash (portable=${portable}): ${source}`, async t => {
    const expected = execFileSync("/bin/bash", ["-c", source], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    t.after(() => shell.dispose());
    const original = globalThis.Buffer;
    try {
      if (portable) Reflect.deleteProperty(globalThis, "Buffer");
      const result = await shell.exec(source);
      assert.equal(result.stdout, expected);
      assert.equal(result.exitCode, 0);
      if (source.includes("1 / 0")) assert.notEqual(result.stderr, "");
      else assert.equal(result.stderr, "");
    } finally { globalThis.Buffer = original; }
  });
}
