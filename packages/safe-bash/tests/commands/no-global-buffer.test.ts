import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands } from "../../src/core.js";
import { yqCommands } from "../../src/commands/yq/index.js";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";

const cases: readonly [string, string, number?, string?][] = [
  ['read here string', `read -r x <<< "hello"; printf '%s\\n' "$x"`, 0, 'hello\n'],
  ['indexed array assignment', `arr=(a b c); printf '%s\\n' "\${arr[1]}"`, 0, 'b\n'],
  ['numeric brace expansion', `printf '%s\\n' {1..3}`, 0, '1\n2\n3\n'],
  ['parameter replacement', `x=foobar; printf '%s\\n' "\${x/foo/baz}"`, 0, 'bazbar\n'],
  ['eval', `eval 'printf "ok\\n"'`, 0, 'ok\n'],
  ['mapfile here string', `mapfile -t lines <<< $'a\\nb'; printf '%s\\n' "\${lines[1]}"`, 0, 'b\n'],
  ['trap listing', `trap 'printf bye' EXIT; trap -p`, 0, "trap -- 'printf bye' EXIT\nbye"],
  ['sort month', `printf 'Feb\\nJan\\n' | sort -M`, 0, 'Jan\nFeb\n'],
  ['cut output delimiter', `printf 'a:b:c\\nd:e:f\\n' | cut -d: -f1,3 --output-delimiter=,`, 0, 'a,c\nd,f\n'],
  ['xargs end marker', `printf 'a\\nEND\\nb\\n' | xargs -E END echo`, 0, 'a\n'],
  ['jq', `jq '.b' /data.json`], ['yq', `yq '.b' /data.json`], ['awk', `awk '{ print $1 }' /in.txt`],
  ['sed', `sed 's/hello/hi/' /in.txt`], ['rg', 'rg hello /in.txt'],
  ['rg capture replacement', `rg '(?<word>hello)' -r '$word/$1/$$' /in.txt`, 0, 'hello/hello/$\n'],
  ['rg glob and numbered matches', `rg -n -g '*.txt' hello /`, 0, '/in.txt:1:hello\n'],
  ['grep extended matches', `grep -Eo '[a-z]+' /in.txt`, 0, 'hello\nworld\n'],
  ['egrep', `egrep -o '[a-z]+' /in.txt`, 0, 'hello\nworld\n'],
  ['fgrep', `fgrep hello /in.txt`, 0, 'hello\n'],
  ['find', `find / -maxdepth 1 -printf '%p\\n'`],
  ['find batched exec', `find / -name 'in.txt' -exec echo {} +`, 0, '/in.txt\n'],
  ['tar', 'tar -cf /out.tar in.txt; tar -tf /out.tar'],
  ['zip', 'zip -q /out.zip in.txt; unzip -p /out.zip in.txt'],
  ['diff', 'diff -u /f1.txt /f2.txt', 1],
  ['patch', `printf '%s\\n' '--- /f1.txt' '+++ /f1.txt' '@@ -1,2 +1,2 @@' ' a' '-b' '+c' | patch /f1.txt`],
  ['apply_patch', `printf '%s\\n' '*** Begin Patch' '*** Update File: /f1.txt' '@@' ' a' '-b' '+c' '*** End Patch' | apply_patch`],
  ['shuf', 'shuf -e hello world'],
  ['split', 'split -l 1 /in.txt /part_'], ['tree', 'tree /'],
  ['column', `printf 'a b\\nc d\\n' | column -t`],
  ['du', 'du -b /in.txt'], ['expr', 'expr 1 + 2'], ['file', 'file /in.txt'],
  ['du human summary', 'du --apparent-size -sh /in.txt', 0, '12\t/in.txt\n'],
  ['expr capture', `expr abcdef : 'abc\\(...\\)'`, 0, 'def\n'],
  ['stat', 'stat /in.txt'], ['mktemp', 'mktemp /tmp.XXXXXX'],
  ['nl', 'nl /in.txt'], ['seq', 'seq -w 1 3'], ['tac', 'tac /in.txt'],
  ['date', 'date -u +%Y'], ['printenv', 'FOO=bar printenv FOO'],
  ['uniq', 'uniq /in.txt', 0, 'hello\nworld\n'],
  ['comm', 'comm /in.txt /in.txt', 0, '\t\thello\n\t\tworld\n'],
  ['join', 'join /in.txt /in.txt', 0, 'hello\nworld\n'],
  ['paste', 'paste /in.txt /in.txt', 0, 'hello\thello\nworld\tworld\n'],
  ['expand', 'expand /in.txt', 0, 'hello\nworld\n'],
  ['fold', 'fold -w 3 /in.txt', 0, 'hel\nlo\nwor\nld\n'],
  ['strings', 'strings /in.txt', 0, 'hello\nworld\n'],
  ['mapfile', 'mapfile -t arr < /in.txt; echo "${arr[0]}"'],
  ['read', `printf 'hello\\nworld\\n' | { read a; read b; echo "$a:$b"; }`],
  ['trap', `trap 'echo hi' EXIT; trap -p`],
  ['comparison', 'a=abc; b=def; [[ "$a" < "$b" ]] | cat'],
  ['case conversion', 'x="héllo"; y="${x^^}"; echo "$y"'],
  ['associative keys', 'declare -A m; m["é"]=42; echo "${m[é]}"'],
];

for (const [name, script, exitCode = 0, stdout] of cases) test(`${name} works without global Buffer`, async context => {
  const fs = createMemoryFileSystem();
  const encoder = new TextEncoder();
  for (const [path, value] of Object.entries({
    '/in.txt': 'hello\nworld\n', '/f1.txt': 'a\nb\n', '/f2.txt': 'a\nc\n',
    '/data.json': '{"a":1,"b":"héllo"}\n',
  })) await fs.writeFile(path, encoder.encode(value));
  const shell = new Shell({ fs }).use(agentCommands()).use(yqCommands());
  context.after(() => shell.dispose());
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Buffer')!;
  try {
    Reflect.deleteProperty(globalThis, 'Buffer');
    const result = await shell.exec(script);
    assert.equal(globalThis.Buffer, undefined);
    assert.equal(result.stderr, '', `${name}: ${result.stderr}`);
    assert.equal(result.exitCode, exitCode, name);
    if (stdout !== undefined) assert.equal(result.stdout, stdout, name);
  } finally { Object.defineProperty(globalThis, 'Buffer', descriptor); }
});
