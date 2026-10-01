import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

const paritySources = [
  'shopt -s extglob; val=foofooabar; printf "%s\\n" "${val##*(foo)}"',
  'shopt -s extglob; val="xx(foo)yy"; printf "%s\\n" "${val#*(foo)}"',
  'set -a; for i in 5; do (( exported_var = $i )); done; export -p',
  'f() { g=$((g + 1)); y=${1:-def}; }; g=0; for i in 1; do f hello; done; printf "g=%s y=%s\\n" "$g" "$y"',
];
for (const assignment of ['(( RANDOM = $s ))', 'printf -v RANDOM "%d" "$s"', 'read RANDOM <<< "$s"']) {
  paritySources.push(`for s in 42; do ${assignment}; done; a=$RANDOM; b=$RANDOM; [[ $a != "$b" ]]; echo "$?"`);
  paritySources.push(`RANDOM=42; a=$RANDOM; b=$RANDOM; for s in 42; do ${assignment}; done; c=$RANDOM; d=$RANDOM; [[ $a == "$c" && $b == "$d" && $c != "$d" ]]; echo "$?"`);
}
paritySources.push(
  'unset RANDOM; RANDOM=42; echo "$RANDOM $RANDOM"',
  'for s in 42; do (( SECONDS = $s )); done; echo "$SECONDS"',
  'for s in 42; do (( LINENO = $s )); done\na=$LINENO\nb=$LINENO\necho "$((b-a))"',
);
for (const operator of ['#', '##', '%', '%%']) {
  for (const pattern of ['*(foo)', '*(foo|bar)', '*foo', 'foo*']) {
    paritySources.push(`shopt -s extglob; val=foofoobarfoo; for i in 1 2; do printf '%s\\n' "\${val${operator}${pattern}}"; done`);
  }
}
for (const maxExpansionBytes of [65536, Infinity]) {
  for (const source of paritySources) {
    test(`scalar and trim fast-path Bash parity (${maxExpansionBytes}): ${source}`, async context => {
      const { shell, commands } = setup({ limits: { maxExpansionBytes, maxExpansionFields: Infinity } });
      for (const command of basicCommands()) commands.register(command);
      context.after(() => shell.dispose());
      const native = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', source], { encoding: 'utf8', env: {} });
      assert.ifError(native.error);
      const result = await shell.exec(source);
      if (source.includes('export -p')) {
        const exported = (output: string) => output.split('\n').filter(line => line.includes('exported_var'));
        assert.deepEqual(exported(result.stdout), exported(native.stdout));
      } else assert.equal(result.stdout, native.stdout);
      assert.equal(result.stderr, native.stderr);
      assert.equal(result.exitCode, native.status);
    });
  }
}

for (const assignment of ['(( SECONDS = $s ))', 'printf -v SECONDS "%d" "$s"', 'read SECONDS <<< "$s"']) {
  test(`SECONDS advances after ${assignment}`, async context => {
    let now = 100000;
    context.mock.method(Date, 'now', () => now);
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    commands.register({ name: 'advance', execute() { now += 3000; return { exitCode: 0 }; } });
    context.after(() => shell.dispose());
    const result = await shell.exec(`for s in 42; do ${assignment}; done; advance; echo "$SECONDS"`);
    assert.equal(result.stdout, '45\n');
    assert.equal(result.stderr, '');
    assert.equal(result.exitCode, 0);
  });
}

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
