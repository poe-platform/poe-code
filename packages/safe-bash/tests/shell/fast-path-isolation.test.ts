import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { Shell } from "../../src/shell/shell.js";
import { standardCommands } from "../../src/commands/index.js";
import { Capture } from "../../src/shell/runtime.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";

test("find pipelines retain async pattern reads and execute deletion once", async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/dir");
  await fs.writeFile("/dir/a.txt", new TextEncoder().encode("hello\n"));
  await fs.writeFile("/patterns.txt", new TextEncoder().encode("a.txt\n"));
  const shell = new Shell({ fs }).use(standardCommands());
  context.after(() => shell.dispose());
  await shell.exec("");
  const matched = await shell.exec('find /dir -name "*.txt" | grep -f /patterns.txt');
  assert.equal(matched.stdout, "/dir/a.txt\n");
  assert.equal(matched.stderr, "");
  assert.equal(matched.exitCode, 0);
  const remove = context.mock.method(fs, "rm");
  const deleted = await shell.exec("find /dir -type f -delete | wc -l");
  assert.equal(deleted.stdout, "0\n");
  assert.equal(deleted.stderr, "");
  assert.equal(deleted.exitCode, 0);
  assert.equal(remove.mock.callCount(), 1);
  assert.deepEqual(await fs.readdir("/dir"), []);
});

for (const [source, expected] of [
  ['arr=(one two three); echo hi | grep ^h; echo "after: ${arr[@]}"', 'hi\nafter: one two three\n'],
  ['export x=outer; f() { local x=inner; env | grep ^x=; }; f; echo "after-f: $x"', 'x=inner\nafter-f: outer\n'],
  ['declare -A arr=([key]=value); [[ abc =~ (b) ]]; echo hi | grep ^h; echo "${arr[key]}:${BASH_REMATCH[1]}"', 'hi\nvalue:b\n'],
  ['x=0; if true; then ((x++)); y=$(echo a; echo b); fi; echo "if-x=$x"', 'if-x=1\n'],
  ['z=0; { ((z++)); y=$(echo a; echo b); }; echo "group-z=$z"', 'group-z=1\n'],
  ['w=0; case foo in foo) ((w++)); y=$(echo a; echo b) ;; esac; echo "case-w=$w"', 'case-w=1\n'],
  ['fn=0; f() { ((fn++)); y=$(echo a; echo b); }; f arg; echo "fn=$fn"', 'fn=1\n'],
] as const) test(`pipeline ownership and compound execution: ${source}`, async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(source);
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, expected);
});

test("ERE matching and capture replacement work without global Buffer", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LANG: "C.UTF-8" } }).use(standardCommands());
  context.after(() => shell.dispose());
  const original = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined!;
    const result = await shell.exec('[[ abc =~ (b) ]]; echo "${BASH_REMATCH[1]}"; [[ xyz =~ (y) ]]; echo "${BASH_REMATCH[1]}"');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "b\ny\n");
  } finally { globalThis.Buffer = original; }
});

for (const [pipeline, expected] of [
  [String.raw`printf 'abc\n123\n' | grep -E '[[:digit:]]+'`, "123"],
  [String.raw`printf '123\nabc\n' | grep -E '[[:alpha:]]+'`, "abc"],
  [String.raw`printf 'x12y34\n' | grep -Eo '[[:digit:]]+'`, "12\n34"],
  [String.raw`printf '123\nAbC\n' | grep -En '[[:alpha:]]+'`, "2:AbC"],
  [String.raw`printf '123\nabc\n' | grep -E '[[:digit:]]+|[[:alpha:]]+'`, "123\nabc"],
  [String.raw`printf '123\n[[:digit:]]\n' | grep -F '[[:digit:]]'`, "[[:digit:]]"],
  [String.raw`printf 'a1b22\n' | grep -Eo '[[:digit:]]+'`, "1\n22"],
  [String.raw`printf '%s\n' '[[:digit:]]+' '123' | grep -F '[[:digit:]]+'`, "[[:digit:]]+"],
  [String.raw`printf '1e5\n2\nInfinity\n1\nNaN\n' | sort -n`, "Infinity\nNaN\n1\n1e5\n2"],
  [String.raw`printf '1e5\n2\nInfinity\n1\n' | sort -nu`, "Infinity\n1e5\n2"],
  [String.raw`printf '  a   b  \n\ta\tb\t\n' | awk -F ' ' '{print $1, $2}'`, "a b\na b"],
] as const) test(`pure substitution matches normal execution: ${pipeline}`, async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(textProgramCommands());
  context.after(() => shell.dispose());
  const direct = await shell.exec(pipeline);
  assert.equal(direct.stdout, expected + "\n");
  const substitution = await shell.exec(`echo "$(${pipeline})"`);
  assert.equal(substitution.stdout, direct.stdout);
  assert.equal(substitution.exitCode, 0);
});

for (const limits of [{ maxCommands: 3 }, { maxOutputBytes: 80 }]) test(`pure substitution bailout charges only fallback: ${JSON.stringify(limits)}`, async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(String.raw`echo "$(printf 'abcdefghijklmnopqrst\n' | grep -E '[')"`);
  assert.equal(result.stdout, "\n");
  assert.match(result.stderr, /grep:/);
});

test("later-stage bailout restores intermediate charges", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxCommands: 4, maxOutputBytes: 110 } }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(String.raw`echo "$(printf 'abcdefghijklmnopqrst\n' | head -n 1 | grep -E '[')"`);
  assert.equal(result.stdout, "\n");
  assert.match(result.stderr, /grep:/);
});

test("pipeline stages execute once even when their result is asynchronous", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(standardCommands());
  await shell.exec("");
  let calls = 0;
  shell.commands.register({ name: "grep", async execute(context) {
    calls++;
    await Promise.resolve();
    await context.stdout.write(new TextEncoder().encode("match\n"));
    return { exitCode: 0 };
  } }, { replace: true });
  const result = await shell.exec("grep | wc -l");
  assert.equal(result.stdout, "1\n");
  assert.equal(calls, 1);
});

for (const flag of ["-l", "-c"]) test(`wc ${flag} charges synchronous input`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/dir");
  await fs.writeFile("/dir/file", new Uint8Array());
  const shell = new Shell({ fs, limits: { maxInputBytes: 1 } }).use(standardCommands());
  await assert.rejects(shell.exec(`find /dir | wc ${flag}`), /maxInputBytes/);
});

test("capture snapshots own their scratch bytes", () => {
  const capture = new Capture();
  capture.resetEmpty();
  capture.enableScratchBuffer();
  capture.write(new TextEncoder().encode("before"));
  const bytes = capture.takeBytes();
  capture.write(new TextEncoder().encode("after!"));
  assert.equal(new TextDecoder().decode(bytes), "before");
});

test("scratch capture works without global Buffer", () => {
  const original = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined!;
    const capture = new Capture();
    capture.resetEmpty();
    capture.enableScratchBuffer();
    capture.write(new TextEncoder().encode("x".repeat(100)));
    assert.equal(capture.takeUtf8Output(), "x".repeat(100));
  } finally { globalThis.Buffer = original; }
});

for (const command of [
  "grep -i hello /dir/a.txt | wc -l",
  "find /dir -type f | wc -l",
  "find /dir -delete | wc -l",
  "sort -o /sorted /dir/a.txt | wc -l",
]) test(`asynchronous pipeline completes cleanly: ${command}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/dir");
  await fs.writeFile("/dir/a.txt", new TextEncoder().encode("HELLO\nworld\n"));
  const shell = new Shell({ fs }).use(standardCommands());
  const result = await shell.exec(command);
  assert.equal(result.exitCode, 0, result.stderr);
  if (command.startsWith("grep")) assert.equal(result.stdout, "1\n");
  if (command.startsWith("sort")) assert.equal(new TextDecoder().decode(await fs.readFile("/sorted")), "HELLO\nworld\n");
});

test("shell source admission works without global Buffer", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  const original = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined!;
    const result = await shell.exec("");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
  } finally { globalThis.Buffer = original; }
});

for (const [header, setup] of [
  ['while [[ -z $called ]]', 'unset called'],
  ['until [[ -n $called ]]', 'unset called'],
  ['for i in 1 2', ''],
  ['for ((i=0;i<2;i++))', ''],
] as const) {
  test(`sync loop resumes function and restores its frame: ${header}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`
      printf -v big '%9000s' a
      set -- topA topB
      f() { local lv=local; echo "pre:$1:$lv"; x=$(echo "$big" | grep a); echo "post:$1:$lv"; }
      ${setup}
      { ${header}; do called=1; echo "iter:$i"; f argA argB; echo "tail:$i"; done; }
      echo "global:$1:$2:$lv:\${FUNCNAME[*]}"
      f again
      echo "final:$1:$2:$lv:\${FUNCNAME[*]}"
      printf 'value:%s\\n' "$x"
    `);
    const indices = header.startsWith('for i') ? ['1', '2'] : header.startsWith('for ((') ? ['0', '1'] : [''];
    assert.equal(result.stderr, '');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, indices.map(i => `iter:${i}\npre:argA:local\npost:argA:local\ntail:${i}\n`).join('') +
      'global:topA:topB::\npre:again:local\npost:again:local\nfinal:topA:topB::\n' +
      'value:' + ' '.repeat(8999) + 'a\n');
  });
}

for (const header of ['for i in 1 2', 'for ((i=0;i<2;i++))']) {
  for (const [name, body, args] of [
    ['assignment', 'x=$(echo "$big" | grep a)', ''],
    ['local initializer', 'local value=$(echo "$big" | grep a); x=$value', ''],
    ['argument', 'x=$1', '"$(echo "$big" | grep a)"'],
    ['array alternate', 'x="${missing[0]:-$(echo "$big" | grep a)}"', ''],
    ['substring index', 'x="${big:0:${lengths[$(echo 0)]}}"', ''],
    ['associative assignment index', 'values[$(echo key)]=$big; x=${values[key]}', ''],
  ]) {
    test(`inline function ${name} preserves expansion and executes once: ${header}`, async context => {
      const big = ' '.repeat(8999) + 'a';
      const shell = new Shell({ fs: new MemoryFileSystem(), env: { big } }).use(standardCommands());
      context.after(() => shell.dispose());
      const result = await shell.exec(`
        seen=0; lengths=(9000); declare -A values
        f() { ${body}; ((seen+=1)); }
        ${header}; do f ${args}; done
        printf '%s:%s:%s\\n' "$seen" "${'${#x}'}" "$x"
      `);
      assert.equal(result.stderr, '');
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, `2:9000:${big}\n`);
    });
  }
}

for (const [name, source] of [
  ['condition cursor', 'i=0; c=0; while ((c+=1)); x=$(echo "$big" | grep a); ((i<2)); do echo "$i:$c"; ((i+=1)); done; echo "end:$i:$c"'],
  ['until condition cursor', 'i=0; c=0; until ((c+=1)); x=$(echo "$big" | grep a); ((i>=2)); do echo "$i:$c"; ((i+=1)); done; echo "end:$i:$c"'],
  ['frozen for list and changed induction value', 'items="a b"; for i in $items; do items=z; i=changed; echo prefix; x=$(echo "$big" | grep a); echo "$i"; done'],
  ['nested body cursor', 'for i in 1 2; do for j in a b; do echo "$i:$j"; x=$(echo "$big" | grep a); echo tail; done; echo outer; done'],
  ['continue after fallback', 'for ((i=0;i<2;i++)); do echo "$i"; x=$(echo "$big" | grep a); continue; echo wrong; done; echo "end:$i"'],
  ['break after fallback', 'for i in 1 2; do echo "$i"; x=$(echo "$big" | grep a); break; echo wrong; done'],
  ['arithmetic step fallback', 'step=1; for ((i=0;i<2;i+=step)); do echo "$i"; step="1+0"; done; echo "end:$i"'],
  ['arithmetic condition fallback', 'stop=2; for ((i=0;i<stop;i++)); do echo "$i"; stop="1+1"; done; echo "end:$i"'],
  ['arithmetic iteration handoff', 'count=0; for ((i=0;i<4100;i++)); do ((count+=1)); done; echo "$count:$i"'],
  ['while iteration handoff', 'i=0; count=0; while ((i++<4100)); do ((count+=1)); done; echo "$count:$i"'],
] as const) test(`sync loop handoff matches Bash: ${name}`, async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  const script = `printf -v big '%9000s' a; { ${source}; }`;
  const expected = execFileSync('/bin/bash', ['-c', script], { encoding: 'utf8' });
  const result = await shell.exec(script);
  assert.equal(result.stderr, '');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, expected);
});

for (const header of ['while ((i<1000))', 'for ((i=0;i<1000;))']) {
  test(`sync fallback keeps the loop iteration budget: ${header}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxLoopIterations: 1000 } }).use(standardCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`printf -v big '%9000s' a; i=0; { ${header}; do ((i++)); if ((i==500)); then x=$(echo "$big" | grep a); fi; :; done; echo "$i"; }`);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, '1000\n');
  });
}
for (const write of ['arr=new', 'printf -v arr %s new', 'read arr <<< new', 'read arr <<< ""']) for (const middleware of [false, true]) {
  test(`allexport promotes an existing array after ${write} (middleware=${middleware})`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => shell.dispose());
    if (middleware) shell.use((_invocation, next) => next());
    const result = await shell.exec(`arr=(x y); set -a; { ${write}; }; declare -p arr`);
    assert.equal(result.stderr, '');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, `declare -ax arr=([0]="${write.endsWith('""') ? '' : 'new'}" [1]="y")\n`);
  });
}

for (const [pipeline, expected] of [
  [String.raw`echo abc | grep '[[:alpha:]]'`, 'abc'],
  [String.raw`echo a1b22 | grep -Eo '[[:digit:]]+'`, '1\n22'],
  [String.raw`printf '%s\n' 1e5 20 | sort -n`, '1e5\n20'],
  [String.raw`echo '  foo   bar' | awk -F ' ' '{print $1}'`, 'foo'],
] as const) test(`function substitution uses shared evaluator: ${pipeline}`, async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(textProgramCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`f() { local value; value=$(${pipeline}); echo "$value"; }; f; f`);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, (expected + '\n').repeat(2));
});

for (const wrap of [(body: string) => `{ ${body}; }`, (body: string) => `f() { ${body}; }; f`]) {
  test(`function substitution budget rollback: ${wrap('value')}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxOutputBytes: 110 } }).use(standardCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(wrap(String.raw`value=$(printf 'abcdefghijklmnopqrst\n' | head -n 1 | grep -E '['); echo "$value"`));
    assert.equal(result.stdout, '\n');
    assert.match(result.stderr, /grep:/);
  });
}

for (const tail of [
  'echo -n second', 'echo -e second', 'echo -ne second', 'echo -en second',
  'echo $v', 'printf %x "$v"', 'printf -v out %x "$v"', 'shift 2',
]) {
  for (const wrapper of [
    (body: string) => `{ ${body}; }`,
    (body: string) => `if true; then ${body}; fi`,
    (body: string) => `case a in a) ${body};; esac`,
    (body: string) => `f() { ${body}; }; f one`,
    (body: string) => `eval '${body}'`,
  ]) test(`compound fallback executes effects once: ${wrapper(tail)}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`v="08"; x=0; ${wrapper(`x=$((x+1)); echo "ran:$x"; ${tail}`)}; echo "final:$x"`);
    assert.equal(result.stdout.split('ran:').length - 1, 1, result.stdout);
    assert.ok(result.stdout.endsWith('final:1\n'), result.stdout);
  });
}

for (const value of ['a b', '', '-n', '-1', '1234567890123456']) test(`runtime expansion fallback executes once: ${JSON.stringify(value)}`, async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`v="${value}"; { x=$((x+1)); echo "ran:$x"; echo $v; printf -v out %x "$v"; }; echo "final:$x"`);
  assert.equal(result.stdout.split('ran:').length - 1, 1, result.stdout);
  assert.ok(result.stdout.endsWith('final:1\n'), result.stdout);
});

for (const body of [
  'local a="${g:=mutated}"; echo "$a"',
  'local a=1; printf -v a "%s" "${g:=mutated}"; echo "$a"',
  'local a=1; a="${g:=mutated}"; echo "$a"',
]) test(`substitution isolates expansion mutations: ${body}`, async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`f() { ${body}; }; x=$(f); echo "x=$x g=$g"`);
  assert.equal(result.stdout, 'x=mutated g=\n');
  assert.equal(result.stderr, '');
});

test('substitution fallback isolates arithmetic and last argument', async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec('v="a b"; f() { local a="${u:=$((g += 5))}"; echo $v:$a; }; g=1; x=$(f); echo "x=$x g=$g u=$u"; : parent_arg; f() { local a=1; echo sub_arg; }; echo "$(f)" "$_"');
  assert.equal(result.stdout, 'x=a b:6 g=1 u=\nsub_arg parent_arg\n');
});

for (const [script, expected] of [
  ["printf 'café\\n' | xargs echo", 'café\n'],
  ["printf 'café\\n' | xargs printf '%s'", 'café'],
  ['x=$(case a in a) :;; esac); echo "ok:$x"', 'ok:\n'],
  ['x=$(if true; then echo ok; fi); echo "$x"', 'ok\n'],
  ['f() { local a=1; echo $a; }; x=$(f); echo "$x"', '1\n'],
  ['LC_ALL=C; x="éabcd"; echo "${x:2:3}:$(echo ok)"', 'abc:ok\n'],
  ["x=$(printf '%s' 'abc' | sed 's/abc/xyz/'); echo \"$x\"", 'xyz\n'],
  ["x=$(printf '%s' 'abc' | cat); echo \"$x\"", 'abc\n'],
]) test(`shell fast paths without Buffer: ${script}`, async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(textProgramCommands());
  context.after(() => shell.dispose());
  const original = globalThis.Buffer;
  try {
    assert.equal(Reflect.deleteProperty(globalThis, "Buffer"), true);
    const result = await shell.exec(script!);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, '');
    assert.equal(result.exitCode, 0);
  } finally { globalThis.Buffer = original; }
});

for (const format of ['x', 'X', 'o', 'u']) {
  for (const operand of ['08', '-1', '1234567890123456']) {
    for (const destination of ['', '-v out ']) test(`printf fallback executes once: ${destination}%${format} ${operand}`, async context => {
      const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
      context.after(() => shell.dispose());
      const result = await shell.exec(`v="${operand}"; { x=$((x+1)); echo "ran:$x"; printf ${destination}%${format} "$v"; }; echo "final:$x"`);
      assert.equal(result.stdout.split('ran:').length - 1, 1, result.stdout);
      assert.ok(result.stdout.endsWith('final:1\n'), result.stdout);
    });
  }
}



for (const command of ['echo', 'f() { echo "${g:-${u:=mutated}}"; }; f']) test(`pure substitution checks nested mutation: ${command}`, async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  const source = command === 'echo' ? 'echo "${g:-${u:=mutated}}"' : command;
  const result = await shell.exec(`x=$(${source}); echo "x=$x u=$u"`);
  assert.equal(result.stdout, 'x=mutated u=\n');
});



for (const argument of ['$((x+=1))', '"${g:=$((x+=1))}"']) test(`function admission does not replay argument mutation: ${argument}`, async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`x=0; f() { echo "$1"; }; f ${argument}; echo "final:$x"`);
  assert.equal(result.stdout, '1\nfinal:1\n');
  assert.equal(result.stderr, '');
});

test('repeated function calls recheck conditional byte values before effects', async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("LC_ALL=en_US.UTF-8; x=0; v=a; f() { ((x+=1)); [[ $v == a ]]; }; f; v=$'\\xff'; f; echo \"final:$x\"");
  assert.equal(result.stdout, 'final:2\n');
  assert.equal(result.stderr, '');
});

test('replacement tilde follows modern Bash quoting rules', async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec('HOME=/home/u; s="hello"; old="l"; echo "${s/$old/~}" ${s/$old/~} "${s/$old/"~"}"');
  assert.equal(result.stdout, 'he/home/ulo he/home/ulo he~lo\n');
  assert.equal(result.stderr, '');
});

test('byte-locale substring preserves a split UTF-8 byte without Buffer', async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  const original = globalThis.Buffer;
  try {
    assert.equal(Reflect.deleteProperty(globalThis, "Buffer"), true);
    const result = await shell.exec('LC_ALL=C; x="éabcd"; echo "${x:1:3}:$(echo ok)"');
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(0xa9, 0x61, 0x62, 0x3a, 0x6f, 0x6b, 0x0a));
    assert.equal(result.stderr, '');
    assert.equal(result.exitCode, 0);
  } finally { globalThis.Buffer = original; }
});

test('portable pipeline decoding preserves an initial UTF-8 BOM', async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  const original = globalThis.Buffer;
  try {
    assert.equal(Reflect.deleteProperty(globalThis, "Buffer"), true);
    const result = await shell.exec('x=$(printf "%s" "\uFEFFabc" | cat); echo "$x"');
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(0xef, 0xbb, 0xbf, 0x61, 0x62, 0x63, 0x0a));
    assert.equal(result.stderr, '');
  } finally { globalThis.Buffer = original; }
});

test("loop redirects retain independent bytes across scratch buffer reuse", async context => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec('mkdir /dir; for ((i=0; i<5; i++)); do echo "val-$i" > "/dir/file-$i.txt"; done');
  assert.equal(result.exitCode, 0, result.stderr);
  for (let i = 0; i < 5; i++) {
    assert.equal(new TextDecoder().decode(await fs.readFile(`/dir/file-${i}.txt`)), `val-${i}\n`);
  }
});
