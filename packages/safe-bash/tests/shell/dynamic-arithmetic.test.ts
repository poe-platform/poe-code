import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const reproduction = [
  's="0123456789abcdef"',
  'arr=(a b c d e f g h i j k l m n o p)',
  'a=10',
  '[[ LINENO -eq 0 ]] && eq0="YES" || eq0="NO"',
  'echo "sub_lineno=${s:LINENO:2}"',
  'echo "arr_lineno=${arr[LINENO]}"',
  'echo "sub_expr=${s:LINENO+1:2}"',
  'echo "arr_expr=${arr[LINENO+1]}"',
  'echo "arith_expr=$(( $a + LINENO ))"',
  'echo "eq0=$eq0"',
].join("\n");

const cases: [string, string][] = [
  ["reported arithmetic consumers", reproduction],
  ["substring offsets and lengths in loops", [
    's=0123456789abcdef',
    'for i in 1 2; do',
    '  x=${s:LINENO:2}',
    '  echo "$x" "${s:LINENO+1:2}" "${s:1:LINENO}"',
    'done',
  ].join("\n")],
  ["substring lines inside a function", [
    's=0123456789abcdef',
    'f() {',
    '  for i in 1 2; do',
    '    x=${s:LINENO:2}',
    '    echo "$x" "${s:1:LINENO+1}"',
    '  done',
    '}',
    'f',
  ].join("\n")],
  ["scalar and array slices", [
    's=0123456789abcdef; arr=(a b c d e f g h i j k l m n o p); text=($s)',
    'echo "${text[0]:LINENO:2}" "${arr[*]:LINENO:2}" "${arr[@]:1:LINENO}"',
    'echo "${s:1:LINENO}" "${text[0]:1:LINENO+1}"',
  ].join("\n")],
  ["named references to the current line", [
    's=0123456789abcdef; arr=(a b c d e f g h i j k l m n o p)',
    'declare -n line=LINENO',
    'echo "${s:line:2}" "${arr[line]}" "$(( 10 + line ))"',
    '[[ line -eq LINENO ]] && echo equal',
  ].join("\n")],
  ["previous argument in arithmetic", [
    's=0123456789abcdef; arr=(a b c d e f g h i j k l m n o p)',
    ': 4',
    'echo "${s:_:2}" "${arr[_]}" "$(( 10 + _ ))"',
    ': 4',
    '[[ _ -eq 4 ]] && echo equal',
  ].join("\n")],
  ["function name in arithmetic", [
    's=0123456789abcdef; arr=(a b c d e f g h i j k l m n o p); f=4',
    'f() {',
    '  echo "${s:FUNCNAME:2}" "${arr[FUNCNAME]}" "$(( 10 + FUNCNAME ))"',
    '  [[ FUNCNAME -eq 4 ]] && echo equal',
    '}',
    'f',
  ].join("\n")],
  ["pipeline status in arithmetic", [
    's=0123456789abcdef; arr=(a b c d)',
    'false | true',
    'echo "${s:PIPESTATUS:2}" "${arr[PIPESTATUS]}" "$(( 10 + PIPESTATUS ))"',
    'false | true',
    '[[ PIPESTATUS -eq 1 ]] && echo equal',
  ].join("\n")],
  ["dynamic indexed arithmetic", [
    'arr=(10 11 12 13 14 15 16 17 18 19)',
    'echo "$(( arr[LINENO] + 1 ))" "$(( arr[$LINENO] + 1 ))"',
    'echo "$(( $a + arr[LINENO] ))" "$(( arr[LINENO+1] ))"',
    ': 4',
    'echo "$(( arr[_] + 1 ))"',
  ].join("\n")],
  ["conditional operands and arithmetic chains", [
    'a=10',
    'echo "$(( a + LINENO + 1 ))" "$(( (a + LINENO) * 2 ))"',
    '[[ LINENO -eq 3 ]] && echo equal',
    '[[ 0 -ne LINENO ]] && echo different',
    '[[ LINENO+1 -gt 5 ]] && echo greater',
  ].join("\n")],
  ["conditional loop effects occur once", [
    'n=0',
    'for i in 1 2; do',
    '  ((n++))',
    '  [[ LINENO -eq 4 ]] && echo "$n"',
    'done',
    'echo "total:$n"',
  ].join("\n")],
  ["integer assignment uses the current line", [
    'declare -i n',
    'for i in 1 2; do',
    '  n=LINENO',
    '  echo "$n"',
    'done',
  ].join("\n")],
  ["unset and empty ordinary operands", 'empty=; echo "$(( 10 + missing ))" "$(( 10 + empty ))"'],
];

for (const operand of ["LINENO", "$LINENO", "${LINENO}"]) {
  for (const operator of ["+", "-", "*", "/", "%"]) {
    cases.push([`${operand} ${operator}`, `a=10\n\necho "$(( $a ${operator} ${operand} ))"`]);
  }
}

for (const header of ["for i in 1 2", "for ((i=1;i<=2;i++))", "i=0; while ((i++<2))"]) {
  cases.push([`arithmetic loop ${header}`, [
    header + '; do',
    '  x=$(( i + LINENO ))',
    '  echo "$x" "$(( $i + LINENO ))"',
    'done',
  ].join("\n")]);
}

for (const [name, source] of cases) {
  for (const invocation of ["inline", "script"] as const) {
    test(`dynamic arithmetic ${name}: ${invocation}`, async context => {
      const fs = new MemoryFileSystem();
      const shell = new Shell({ fs });
      for (const command of basicCommands()) shell.commands.register(command);
      context.after(() => shell.dispose());
      const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { LC_ALL: "C" } });
      assert.equal(native.status, 0, native.stderr);
      assert.equal(native.stderr, "");
      if (source === reproduction) assert.equal(native.stdout, "sub_lineno=56\narr_lineno=g\nsub_expr=89\narr_expr=j\narith_expr=19\neq0=NO\n");
      if (invocation === "script") await fs.writeFile("/program", new TextEncoder().encode(source));
      for (const run of ["cold", "warm"]) {
        const result = await shell.exec(invocation === "script" ? "bash /program" : source);
        assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }, { stdout: native.stdout, stderr: native.stderr, exitCode: native.status }, run);
      }
    });
  }
}
