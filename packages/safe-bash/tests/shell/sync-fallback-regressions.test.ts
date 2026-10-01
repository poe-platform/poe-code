import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

const cases: Array<[string, string]> = [
  ['d=";"; for i in 1 2; do read -r -d "$d"; echo "<$_>"; done <<< "one;two;"', '<;>\n<;>\n'],
  ['REPLY=";suffix"; for i in 1; do read -r -d "$REPLY"; echo "<$_>:$REPLY"; done <<< "value;"', '<;suffix>:value\n'],
  ['d=";"; for i in 1; do read -d "$d" -r; echo "<$_>:$REPLY"; done <<< "value;"', '<-r>:value\n'],
  ['d=";"; for i in 1; do read -r -d "$d" value; echo "<$_>:$value"; done <<< "value;"', '<value>:value\n'],
  ['for i in {1..3}; do echo "hi_$i"; done', 'hi_1\nhi_2\nhi_3\n'],
  ['echo "$(for i in {1..3}; do echo "hi_$i"; done)"', 'hi_1\nhi_2\nhi_3\n'],
  ['for i in {1..3}; do echo "hi_$i"; done > /out.txt; pass < /out.txt', 'hi_1\nhi_2\nhi_3\n'],
  ['a=0; let "a++, b = 1 / 0"; result=$?; echo "a=$a status=$result"', 'a=1 status=1\n'],
  ['a=0; let "a++, b = 1 / 0" || true; echo "a=$a"', 'a=1\n'],
  ['count=0; f() { count=$((count + 1)); shift 1; echo "arg1=$1"; }; f first second; echo "count=$count"', 'arg1=second\ncount=1\n'],
];
// GNU Bash 5.2.37 joins quoted slices using the first nonempty IFS character.
for (const ifs of [":", "", " ", "|:"]) {
  for (const quoted of [true, false]) {
    const quote = quoted ? '"' : '';
    cases.push([
      `arr=(a b c); IFS='${ifs}'; at=${quote}\${arr[@]}${quote}; star="\${arr[*]}"; slice_at=${quote}\${arr[@]:1:2}${quote}; slice_star="\${arr[*]:1:2}"; echo "at=$at star=$star slice_at=$slice_at slice_star=$slice_star"`,
      `at=a b c star=${['a', 'b', 'c'].join(ifs[0] ?? '')} slice_at=${['b', 'c'].join(quoted && ifs ? ifs[0] : ' ')} slice_star=${['b', 'c'].join(ifs[0] ?? '')}\n`,
    ]);
  }
}
for (const body of ['shift 1', 'shift 9', 'unset tmpv', 'unset arr', 'unset IFS', 'unset PATH', 'export EXP_V=42', 'let "lv = 10"']) {
  for (const wrap of [
    (s: string) => `{ ${s}; }`,
    (s: string) => `if true; then ${s}; fi`,
    (s: string) => `case x in x) ${s};; esac`,
    (s: string) => `f() { local loc=1; pass < /dev/null; { ${s}; }; }; f first second`,
  ]) {
    cases.push([`arr=(1 2); count=0; ${wrap(`count=$((count + 1)); ${body}`)}; echo "count=$count"`, 'count=1\n']);
  }
}
for (const maxExpansionBytes of [65536, Infinity]) {
  for (const [source, stdout] of cases) {
    test(`sync fallback (${maxExpansionBytes}): ${source}`, async context => {
      const { shell, commands } = setup({ limits: { maxExpansionBytes } });
      for (const command of basicCommands()) commands.register(command);
      context.after(() => shell.dispose());
      const result = await shell.exec(source);
      assert.equal(result.stdout, stdout);
      assert.equal(result.exitCode, 0);
      if (source.includes('1 / 0')) assert.match(result.stderr, /division by 0/);
      else assert.equal(result.stderr, "");
    });
  }
}
