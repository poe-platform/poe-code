import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";
import { createStandardCommands, standardCommands } from "../../src/commands/index.js";
import { arraysExtension } from "../../src/shell/extensions/arrays/index.js";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { Shell } from "../../src/shell/shell.js";

for (const extensions of [[], [arraysExtension()]]) for (const flags of ["a", "A", "ai"]) {
  for (const [assignment, suffix] of [["", ""], ["=()", "=()"]]) {
    test(`declare -p preserves array initialization (${extensions.length}, ${flags}, ${assignment})`, async t => {
      const { shell, commands } = setup({ extensions });
      for (const command of basicCommands()) commands.register(command);
      t.after(() => shell.dispose());
      const result = await shell.exec(`declare -${flags} v${assignment}; declare -p v; printf '<%s>' "\${v+set}"`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `declare -${flags} v${suffix}\n<>`);
    });
  }
  test(`array initialization survives scopes and removal (${extensions.length}, ${flags})`, async t => {
    const { shell } = setup({ extensions });
    t.after(() => shell.dispose());
    const result = await shell.exec(`
      declare -${flags} v
      (typeset -p v; v=(); declare -p v)
      f() { local -${flags} v; local -p v; v=(); local -p v; }
      f
      declare -p v
      v[0]=1
      unset 'v[0]'
      declare -p v
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, ["", "=()", "", "=()", "", "=()"].map(suffix => `declare -${flags} v${suffix}\n`).join(""));
  });
}

for (const extensions of [[], [arraysExtension()]]) for (const [declaration, expected] of [
  ["declare OPTIND", "a:1"],
  ["typeset OPTIND", "a:1"],
  ["declare -i OPTIND", "a:1"],
  ["typeset -i OPTIND", "a:1"],
  ["declare -x OPTIND", "a:1"],
  ["declare -p OPTIND >/dev/null", "b:2"],
  ["typeset -p OPTIND >/dev/null", "b:2"],
  ["export OPTIND", "b:2"],
  ["OPTIND=1", "a:1"],
]) {
  test(`OPTIND declaration preserves Bash getopts behavior (arrays=${extensions.length}): ${declaration}`, async t => {
    const { shell, commands } = setup({ extensions });
    for (const command of basicCommands()) commands.register(command);
    t.after(() => shell.dispose());
    const result = await shell.exec(`set -- -ab; getopts ab flag; echo "$flag:$OPTIND"; ${declaration}; getopts ab flag; echo "$flag:$OPTIND"`);
    assert.equal(result.stdout, `a:1\n${expected}\n`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

for (const command of ["declare", "typeset"]) {
  test(`${command} OPTIND preserves progress within a later getopts cluster`, async t => {
    const { shell } = setup();
    t.after(() => shell.dispose());
    const result = await shell.exec(`set -- -a -bcd; getopts abcd flag; getopts abcd flag; ${command} OPTIND; getopts abcd flag; say "$flag:$OPTIND"`);
    assert.equal(result.stdout, "c:2\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

for (const extensions of [[], [arraysExtension()]]) for (const command of ["declare", "typeset", "local"]) {
  for (const [source, expected] of [
    [`set -a; ${command} +x V=new`, "V=new\nparent:new\n"],
    [`set +a; ${command} +x V=new`, "parent:new\n"],
    [`set -a; ${command} V=new; ${command} +x V`, "parent:new\n"],
    [`set -a; ${command} V=old; ${command} +x V+=new`, "V=oldnew\nparent:oldnew\n"],
    [`set -a; ${command} +x V=`, "V=\nparent:\n"],
    ["set -a; export -n V=new", "parent:new\n"],
  ]) test(`declaration allexport (${extensions.length ? "arrays" : "default"}, ${command}): ${source}`, async t => {
    const { shell, commands } = setup({ extensions });
    for (const builtin of createStandardCommands()) commands.register(builtin);
    t.after(() => shell.dispose());
    const body = `${source}; env | while IFS= read -r row; do case "$row" in V=*) echo "$row";; esac; done; echo "parent:$V"`;
    const result = await shell.exec(command === "local" ? `f() { ${body}; }; f` : body);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

for (const extensions of [[], [arraysExtension()]]) for (const command of ["declare", "typeset"]) {
  for (const initial of ["unset x", "x=old"]) for (const [body, call, expected] of [
    [`${command} -g x=global; echo "$x"`, "x=temp f", "temp\nglobal\n"],
    [`local x=local; ${command} -g x=global; echo "$x"`, "x=temp f", "local\nglobal\n"],
    [`${command} -g x=global; echo "$x"`, "f", "global\nglobal\n"],
    [`local x=temp; ${command} -g x=global; echo "$x"`, "f", "temp\nglobal\n"],
    [`g() { ${command} -g x=global; echo "$x"; }; x=inner g; echo "$x"`, "x=temp f", "inner\ntemp\nglobal\n"],
    [`local x=local; g() { ${command} -g x=global; echo "$x"; }; x=inner g; echo "$x"`, "f", "inner\nlocal\nglobal\n"],
  ]) test(`global declaration (${extensions.length ? "arrays" : "default"}): ${initial}; ${body}; ${call}`, async t => {
    const { shell, commands } = setup({ extensions });
    for (const builtin of basicCommands()) commands.register(builtin);
    t.after(() => shell.dispose());
    const result = await shell.exec(`${initial}; f() { ${body}; }; ${call}; echo "\${x-unset}"`);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

for (const extensions of [[], [arraysExtension()]]) {
  for (const [flag, initial, value, outer, direct, appended] of [
    ["i", "7", "2+3", "7", "5", "12"],
    ["u", "old", "mIx", "OLD", "MIX", "OLDMIX"],
    ["l", "OLD", "mIx", "old", "mix", "oldmix"],
  ]) {
    test(`function prefix shadows -${flag} assignment attributes (arrays=${extensions.length})`, async t => {
      const { shell, commands } = setup({ extensions });
      for (const command of basicCommands()) commands.register(command);
      t.after(() => shell.dispose());
      const result = await shell.exec(`declare -${flag} x=${initial};
        g() { declare -p x; x=${value}; declare -p x; };
        f() { declare -p x; x=${value}; declare -p x; x=nested g; declare -p x; };
        x=${value} f; declare -p x;
        h() { declare -p x; x=${value}; declare -p x; return 3; };
        x+=${value} h; printf '%s\\n' "$?"; declare -p x;
        x=${value}; declare -p x`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, [
        `declare -x x="${value}"`, `declare -x x="${value}"`,
        'declare -x x="nested"', `declare -x x="${value}"`,
        `declare -x x="${value}"`, `declare -${flag} x="${outer}"`,
        `declare -x x="${appended}"`, `declare -x x="${value}"`, "3",
        `declare -${flag} x="${outer}"`,
        `declare -${flag} x="${direct}"`, "",
      ].join("\n"));
    });
  }
}

for (const middleware of [false, true]) for (const [source, stdout, exitCode] of [
  ['set -a; { say() { echo called; }; }; set +a; bash -c say', 'called\n', 0],
  ['set -o allexport; { say() { echo called; }; }; set +o allexport; bash -c "bash -c say"', 'called\n', 0],
  ['set -a; { say() { echo old; }; }; set +a; say() { echo called; }; bash -c say', 'called\n', 0],
  ['say() { echo called; }; export -f say; bash -c say', 'called\n', 0],
  ['say() { echo called; }; bash -c say', '', 127],
  ['set -a; { say() { echo called; }; }; set +a; export -fn say; bash -c say', '', 127],
] as const) {
  test(`function allexport (middleware=${middleware}): ${source}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => shell.dispose());
    if (middleware) shell.use((_invocation, next) => next());
    const result = await shell.exec(source);
    assert.equal(result.stdout, stdout);
    assert.equal(result.exitCode, exitCode);
    if (exitCode === 0) assert.equal(result.stderr, '');
    else assert.ok(result.stderr.includes('say: command not found'));
  });
}

for (const extensions of [[], [arraysExtension()]]) for (const command of ["declare", "typeset"]) {
  for (const initial of ["unset V", "V=old", "export V=old"]) {
    for (const declaration of ["V", "V=fixed", "+x V", "-x V", "-x V=fixed", "-r V"]) {
      test(`temporary declaration assignment (${extensions.length ? "arrays" : "default"}): ${initial}; V=temp ${command} ${declaration}`, async t => {
        const { shell, commands } = setup({ extensions });
        for (const builtin of basicCommands()) commands.register(builtin);
        t.after(() => shell.dispose());
        const persistent = declaration.startsWith("-x") || declaration.startsWith("-r");
        const parent = persistent ? declaration.endsWith("=fixed") ? "fixed" : "temp" : initial === "unset V" ? "unset" : "old";
        const child = persistent ? parent : initial === "export V=old" ? "old" : "unset";
        const result = await shell.exec(`${initial}; V=temp ${command} ${declaration}; printf 'parent:%s\\n' "\${V-unset}"; sh -c 'printf "child:%s\\n" "\${V-unset}"'`);
        assert.equal(result.stdout, `parent:${parent}\nchild:${child}\n`);
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
      });
    }
  }
}

for (const [source, stdout, exitCode] of [
  [
    "declare -i value=08; printf \"unreachable\\n\"",
    "",
    1
  ],
  [
    "declare -i value=1/0; printf \"unreachable\\n\"",
    "",
    1
  ],
  [
    "f(){ printf \"before\\n\"; local -i value=08; printf \"unreachable\\n\"; }; f; printf \"after\\n\"",
    "before\n",
    1
  ],
  [
    "declare -i value=1; value=08; printf \"unreachable\\n\"",
    "",
    1
  ],
  [
    "declare -ai value=(1); value[0]=08; printf \"unreachable\\n\"",
    "",
    1
  ],
  [
    "(declare -i value=08; printf \"unreachable\\n\"); printf \"after:%s\\n\" \"$?\"",
    "after:1\n",
    0
  ],
  [
    "unset OPTIND; declare -i OPTIND=08; printf \"unreachable\\n\"",
    "",
    1
  ]
] as const) test(`integer assignment failures stop the current shell: ${source}`, async t => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  t.after(() => shell.dispose());
  const result = await shell.exec(source);
  assert.equal(result.exitCode, exitCode);
  assert.equal(result.stdout, stdout);
  assert.match(result.stderr, /value too great for base|division by 0/u);
});

test("explicit integer OPTIND after unset retains octal arithmetic", async t => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  t.after(() => shell.dispose());
  const result = await shell.exec('unset OPTIND; declare -i OPTIND=010; printf "%s\\n" "$OPTIND"; OPTIND=011; printf "%s\\n" "$OPTIND"');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "8\n9\n");
  assert.equal(result.stderr, "");
});


for (const [source, expected] of [
  ['x=hello; declare x+=world; printf %s "$x"', 'helloworld'],
  ['declare -i n=10; declare n+=2+3; printf %s "$n"', '15'],
  ['p=/usr/bin; export p+=/custom; envget p', '/usr/bin/custom'],
  ['declare -i n=10; export n+=5; envget n', '15'],
  ['f(){ local s=foo; local s+=bar; printf %s "$s"; }; f', 'foobar'],
  ['f(){ local -i n=10; local n+=5; printf %s "$n"; }; f', '15'],
  ['f(){ local -r x=42; local -x e=hi; local -A m; m[k]=v; printf "%s," "$x"; envget e; printf ",%s" "${m[k]}"; }; f', '42,hi,v'],
  ['f(){ local -l x=HELLO; local -u y=world; printf "%s,%s" "$x" "$y"; }; f', 'hello,WORLD'],
  ['declare -i x=7; f(){ local -I x; x=2+3; printf "%s," "$x"; }; f; printf %s "$x"', '5,7'],
  ['f(){ local -ai x; x[0]=2+3; printf %s "${x[0]}"; }; f', '5'],
  ['f(){ local -ar x=(hello world); printf %s "${x[1]}"; }; f', 'world'],
  ['x=123; declare -p x', 'declare -- x="123"\n'],
  ['declare -i x=3; declare -p x', 'declare -i x="3"\n'],
  ['f(){ local -rx x=hi; local -p x; }; f', 'declare -rx x="hi"\n'],
  ['f(){ local x=hi; local -p; }; f', 'declare -- x="hi"\n'],
  ['typeset -i k=2+3; typeset k+=2; typeset -p k', 'declare -i k="7"\n'],
  ['typeset -a x=(hello world); typeset -p x', 'declare -a x=([0]="hello" [1]="world")\n'],
  ['x=hi; declare -p missing x; printf %s "$?"', 'declare -- x="hi"\n1'],
  ['f(){ local -ai x=(2+3); local -ai x+=2; printf %s "${x[0]}"; }; f', '7'],
  ['declare -ai x=(10); declare x+=5; printf %s "${x[0]}"', '15'],
  ['typeset -a x=(hello); typeset -a x+=world; printf %s "${x[0]}"', 'helloworld'],
  ['x=outer; f(){ local -urx x=inner; }; f; x=next; printf %s "$x"; envget x', 'next<unset>'],
  ['f(){ local -A x=([key]=value); local -p x; }; f', 'declare -A x=(["key"]="value")\n'],
  ['f(){ local -a x; local -p; }; f', 'declare -a x\n'],
  ['declare -i ZZ=2; declare -p', 'declare -r BASHOPTS="globskipdots:patsub_replacement:sourcepath"\ndeclare -- BASH_ARGV0="virtual-bash"\ndeclare -- BASH_COMMAND="declare -p"\n' + "declare -- IFS=$' \\t\\n'\n" + 'declare -- OPTERR="1"\ndeclare -- OPTIND="1"\ndeclare -a PIPESTATUS=([0]="0")\ndeclare -x PWD="/"\ndeclare -r SHELLOPTS="braceexpand:hashall"\ndeclare -i ZZ="2"\n'],
  ['declare x; declare -p x', 'declare -- x\n'],
] as const) test(`declaration compatibility: ${source}`, async t => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  t.after(() => shell.dispose());
  const result = await shell.exec(source);
  assert.equal(result.stdout, expected);
  assert.equal(result.exitCode, 0);
  if (source.includes('-p missing')) assert.ok(result.stderr.includes('not found'));
  else assert.equal(result.stderr, '');
});

for (const [source, expected, diagnostic] of [
  ['f(){ printf hello; }; readonly -f f; f(){ printf changed; }; f', 'hello', 'f: readonly function'],
  ['f(){ printf hello; }; readonly -f f; f(){ printf changed; }; printf "%s:" "$?"; f', '1:hello', 'f: readonly function'],
  ['f(){ printf hello; }; readonly -f f; unset -f f; printf "%s:" "$?"; f', '1:hello', 'unset: f: cannot unset: readonly function'],
  ['readonly -f missing; printf %s "$?"', '1', 'readonly: missing: not a function'],
  ['f(){ printf hello; }; readonly -f f; (f(){ printf changed; }; f); f', 'hellohello', 'f: readonly function'],
  ['f(){ printf hello; }; (readonly -f f); f(){ printf changed; }; f', 'changed', ''],
  ['f=variable; f(){ printf hello; }; readonly -f f; unset -v f; f', 'hello', ''],
  ['f(){ printf hello; }; unset -f f; declare -F f; printf %s "$?"', '1', ''],
  ['f(){ printf hello; }; readonly -fp f; readonly -f', 'f () \n{ \n    printf hello\n}\ndeclare -fr f\n', ''],
] as const) test(`readonly functions: ${source}`, async () => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  try {
    const result = await shell.exec(source);
    assert.equal(result.stdout, expected);
    assert.equal(result.exitCode, 0);
    if (diagnostic) assert.ok(result.stderr.includes(diagnostic), result.stderr);
    else assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

for (const [source, expected] of [
  ['declare a=hello; printf %s "$a"', 'hello'],
  ['declare -i a=1; a="2+3"; printf %s "$a"', '5'],
  ['declare -l a=HELLO; a=WORLD; printf %s "$a"', 'world'],
  ['declare -u a=hello; printf %s "$a"', 'HELLO'],
  ['declare -n ref=target; target=hello; printf %s "$ref"; ref=world; printf %s "$target"', 'helloworld'],
  ['declare -x VALUE=hello; sh -c \'printf %s "$VALUE"\'', 'hello'],
  ['f(){ declare -g a=hello; }; f; printf %s "$a"', 'hello'],
  ['a=outer; f(){ declare a=inner; printf %s "$a"; }; f; printf %s "$a"', 'innerouter'],
  ['declare -i a=7; f(){ declare -I a; a=2+3; printf "[%s]" "$a"; }; f; printf "[%s]" "$a"', '[5][7]'],
  ['f(){ printf SYNTHETIC; }; declare -F f', 'f\n'],
  ['f(){ printf SYNTHETIC; }; declare -f f', 'f () \n{ \n    printf SYNTHETIC\n}\n'],
  ['f(){ printf SYNTHETIC; }; declare -ft f; printf %s "$?"', '0'],
  ['declare -i a=7; (a=2+3; printf %s "$a"); printf %s "$a"', '57'],
  ['declare -i a=7; declare +i a; a=2+3; printf %s "$a"', '2+3'],
  ['declare -r a=old; declare a=new; printf %s "$a"', 'old'],
  ['a=outer; f(){ declare -r a=inner; printf %s "$a"; }; f; a=new; printf %s "$a"', 'innernew'],
  ['declare -i target=1; declare -n ref=target; ref=2+3; printf %s "$ref"', '5'],
  ['declare -a a; a[1]=hello; printf %s "${a[1]}"', 'hello'],
  ['declare -l a; a=$(printf "\\377ABC"); printf %s "$a"', '\ufffdabc'],
] as const) test(`declare: ${source}`, async () => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  try {
    const result = await shell.exec(source);
    assert.equal(result.stdout, expected);
    if (!source.startsWith('declare -r')) assert.equal(result.stderr, "");
    else assert.ok(result.stderr.includes("readonly variable"));
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const [source, expected] of [
  ['VALUE=hello; export VALUE; export -n VALUE; sh -c \'printf %s "${VALUE-unset}"\'; printf ":%s" "$VALUE"', 'unset:hello'],
  ['export VALUE=old; export -n VALUE=new; bash -c \'printf %s "${VALUE-unset}"\'; printf ":%s" "$VALUE"', 'unset:new'],
  ['readonly VALUE=hello; export VALUE; export -n VALUE; envget VALUE; printf ":%s" "$VALUE"', '<unset>:hello'],
  ['f(){ printf hello; }; export -f f; bash -c f', 'hello'],
  ['f(){ printf hello; }; export -f f; bash -c \'bash -c f\'', 'hello'],
  ['f(){ printf old; }; export -f f; f(){ printf new; }; bash -c f', 'new'],
  ['f(){ printf hello; }; export -f f; export -fn f; bash -c \'type -t f\'; f', 'hello'],
  ['f(){ printf hello; }; export -f f; (export -fn f); bash -c f', 'hello'],
  ['f(){ printf hello; }; export -f f; env -i bash -c \'type -t f\'; printf %s "$?"', '1'],
  ['export AUDIT=SYNTHETIC; export -p', 'declare -x AUDIT="SYNTHETIC"\ndeclare -x PWD="/"\n'],
  ['export AUDIT=\'a"b\\c$`\'; export -p', 'declare -x AUDIT="a\\"b\\\\c\\$\\`"\ndeclare -x PWD="/"\n'],
  ["export AUDIT='a\nb'; export -p", "declare -x AUDIT=$'a\\nb'\ndeclare -x PWD=\"/\"\n"],
  ['export ABSENT; export -p', 'declare -x ABSENT\ndeclare -x PWD="/"\n'],
  ['export -p AUDIT=hello; envget AUDIT', 'hello'],
  ['f(){ printf hello; }; export -f f; export -fp', 'f () \n{ \n    printf hello\n}\ndeclare -fx f\n'],
  ['f(){ printf hello; }; export -f f; export -f', 'f () \n{ \n    printf hello\n}\ndeclare -fx f\n'],
  ['f(){ printf hello; }; export -f f; printf "f\\n" > script.sh; bash script.sh', 'hello'],
  ['f(){ printf hello; }; g(){ printf private; }; export -f f; bash -c \'type -t g\'; printf %s "$?"', '1'],
  ['export -- VALUE=hello; export -np VALUE; envget VALUE', '<unset>'],
  ['export -f missing; printf %s "$?"', '1'],
  ['export -z; printf %s "$?"', '2'],
] as const) test(`export: ${source}`, async () => {
  const { shell, commands } = setup();
  for (const command of createStandardCommands()) commands.register(command);
  try {
    const result = await shell.exec(source);
    assert.equal(result.stdout, expected);
    if (source.startsWith('export -f missing')) assert.ok(result.stderr.includes('not a function'));
    else if (source.startsWith('export -z')) assert.ok(result.stderr.includes('invalid option'));
    else assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

test('exported functions respect env -i in script shebangs', async t => {
  const { shell, fs, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  t.after(() => shell.dispose());
  await fs.writeFile('/script.sh', new TextEncoder().encode('#!/usr/bin/env -S -i bash\ntype -t f\n'), { mode: 0o755 });
  const result = await shell.exec('f(){ printf hello; }; export -f f; ./script.sh; printf %s "$?"');
  assert.equal(result.stdout, '1');
  assert.equal(result.stderr, '');
  assert.equal(result.exitCode, 0);
});
