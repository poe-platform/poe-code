import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createStreamFormatCommands } from "../../src/commands/stream-format/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

async function run(source: string, bounded = false) {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createStreamFormatCommands()]) });
  try { return await shell.exec(source, bounded ? { limits: { maxExpansionBytes: 4096 } } : {}); }
  finally { await shell.dispose(); }
}

for (const [source, stdout] of [
  ['echo $(dirname /a/b); echo $(basename /a/b.txt .txt)', '/a\nb\n'],
  ['f() { local arr; arr=(1 2); }; for _ in 1; do f; done; echo "len=${#arr[@]} val=${arr[@]}"', 'len=0 val=\n'],
  ['f() { local arr; arr[0]=99; }; for _ in 1; do f; done; echo "len=${#arr[@]} val=${arr[@]}"', 'len=0 val=\n'],
  ['f() { local arr; read -a arr <<< "a b"; }; for _ in 1; do f; done; echo "len=${#arr[@]} val=${arr[@]}"', 'len=0 val=\n'],
  ['arr=(o1 o2); f() { local -a arr; arr=(in); }; for _ in 1; do f; done; echo "${arr[@]}"', 'o1 o2\n'],
  ['f() { local -a arr; arr=(one two); local -a arr; echo "${arr[@]}"; }; for _ in 1; do f; done', 'one two\n'],
  ['f() { local arr; for ((i=0;i<2;i++)); do arr+=(one); done; echo "${arr[@]}"; }; f; echo "len=${#arr[@]}"', 'one one\nlen=0\n'],
  ['arr=outer; f() { local arr; arr=(one two); }; f; echo "$arr"', 'outer\n'],
  ['arr=(outer); f() { local arr; arr=(inner); }; f; echo "${arr[@]}"', 'outer\n'],
  ['arr=(outer); f() { local x; for ((i=0;i<2;i++)); do arr[0]=inner; done; }; f; echo "${arr[@]}"', 'inner\n'],
  ['outer() { local -a arr; arr=(outer); inner() { local -a arr; arr=(inner); }; inner; echo "${arr[@]}"; }; outer; echo "len=${#arr[@]}"', 'outer\nlen=0\n'],
  ['arr=(a b c); IFS=:; x=${arr[*]}; echo "$x"', 'a:b:c\n'],
  ['arr=(a b c); IFS=:; x="${arr[*]}"; echo "$x"', 'a:b:c\n'],
  ['arr=(a b c); IFS=:; [[ ${arr[*]} == "a b c" ]] && echo ok; case ${arr[*]} in "a b c") echo ok;; esac', ''],
  ['HOME=/home; arr=(/home/a /home/b); x=${arr[@]#~/}; echo "$x"', 'a b\n'],
  ['HOME=/home; arr=(/home/a /home/b); x=${arr[@]/~/X}; echo "$x"', 'X/a X/b\n'],
  ['IFS=:; HOME=/home; arr=(/home/a /home/b); x=${arr[*]#~/}; echo "$x"', 'a b\n'],
  ['echo $(printf "😀abc\\n" | cut -c 1-2)', '😀a\n'],
  ['echo $(printf "😀abc" | cut -c 1-1)', '😀\n'],
] as const) {
  test(source, async () => {
    for (const bounded of [false, true]) {
      const result = await run(source, bounded);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, stdout);
    }
  });
}

for (const ifs of [":", ""]) for (const expression of ['${a[*]}', '"${a[*]}"', '${a[@]}', '"${a[@]}"', '"${!a[@]}"']) {
  for (const route of ["assignment", "here-string"]) {
    const source = `a=([2]=x [10]=y); IFS='${ifs}'; ` + (route === "assignment"
      ? `value=${expression}; printf '%s|%s' "$value" "$IFS"`
      : `IFS= read -r value <<<${expression}; printf '%s|%s' "$value" "$IFS"`);
    const expected = expression === '"${!a[@]}"' ? `2${ifs || " "}10`
      : expression.includes("[*]") ? `x${ifs}y` : "x y";
    test(`scalar ${route} joins ${expression} with IFS=${JSON.stringify(ifs)}`, async () => {
      for (const bounded of [false, true]) {
        const result = await run(source, bounded);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, `${expected}|${ifs}`, `bounded=${bounded}`);
      }
    });
  }
}

for (const expression of ['"${a[*]}"', '"${!a[@]}"']) test(`read prefix preserves raw IFS for ${expression}`, async () => {
  for (const bounded of [false, true]) {
    const result = await run(`a=([2]=x [10]=y); IFS=$'\\xff'; IFS= read -r value <<<${expression}; printf '%s|%s' "$value" "$IFS"`, bounded);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    const expected = expression.includes("!") ? [50, 255, 49, 48, 124, 255] : [120, 255, 121, 124, 255];
    assert.deepEqual([...result.stdoutBytes], expected, `bounded=${bounded}`);
  }
});

for (const stage of ['head -n 1', 'tail -n 1', 'rev']) {
  for (const [flag, count] of [['-c', '3'], ['-l', '0']] as const) {
    test(`${stage} preserves an unterminated line before wc ${flag}`, async () => {
      const result = await run(`echo $(printf "abc" | ${stage} | wc ${flag})`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `${count}\n`);
    });
  }
}

test('cut rejects decreasing ranges inside substitution', async () => {
  for (const source of ['x=$(printf "abc" | cut -c 4-2); echo $?', 'printf "abc" | cut -c 4-2; echo $?']) {
    const result = await run(source);
    assert.equal(result.stdout, '1\n');
    assert.ok(result.stderr.startsWith("cut: invalid decreasing range"));
  }
});

test('shell operations work without host Buffer or path globals', async () => {
  const buffer = Object.getOwnPropertyDescriptor(globalThis, 'Buffer');
  const path = Object.getOwnPropertyDescriptor(globalThis, 'path');
  Reflect.deleteProperty(globalThis, 'Buffer');
  Reflect.deleteProperty(globalThis, 'path');
  try {
    for (const [source, stdout] of [
      ['echo $(dirname /a/b); echo $(basename /a/b.txt .txt)', '/a\nb\n'],
      ['trap "x=1" EXIT; trap -p', "trap -- 'x=1' EXIT\n"],
      ['eval "f() { :; }"; f; echo ok', 'ok\n'],
      ['for i in 1 2; do printf "%s" é; done', 'éé'],
      ['echo $(printf "%s" é)', 'é\n'],
      ['LC_ALL=C; x=abc; echo ${x:1:1}', 'b\n'],
      ['read x <<< "abc"; echo "$x"', 'abc\n'],
      [`read x <<< "${'a'.repeat(100)}"; echo "$x"`, `${'a'.repeat(100)}\n`],
      [`mapfile -t arr <<< "${'a'.repeat(100)}"; echo "${'${arr[0]}'}"`, `${'a'.repeat(100)}\n`],
      ['x=$(for i in 1 2; do echo x; done); echo "$x"', 'x\nx\n'],
      ['x=$(f() { echo ok; }; f); echo "$x"', 'ok\n'],
    ] as const) {
      const result = await run(source);
      assert.equal(result.exitCode, 0, source);
      assert.equal(result.stderr, '', source);
      assert.equal(result.stdout, stdout, source);
    }
  } finally {
    if (buffer) Object.defineProperty(globalThis, 'Buffer', buffer);
    if (path) Object.defineProperty(globalThis, 'path', path);
  }
});
