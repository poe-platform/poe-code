import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { Shell } from "../../../../src/shell/shell.js";

const cases = [
  ['a=(a b c d); printf "<%s>" "${a[@]:1:2}"', '<b><c>'],
  ['a=([2]=a [5]=b [9]=c); printf "<%s>" "${a[@]:3:2}"', '<b><c>'],
  ['a=(a b c d); IFS=:; printf "<%s>" "${a[*]: -2:1}"', '<c>'],
  ['a=(a b c d); printf "<%s>" "${a[@]:8}"', '<>'],
  ['a=(a b c d); printf "<%s>" "${a[@]: -2}"', '<c><d>'],
  ['a=(x y); i=0; a[i++]=z; printf "%s:%s" "${a[0]}" "$i"', 'z:1'],
  ['a=scalar; printf "%s" "${a[-1]}"', 'scalar'],
  ['a=(x y); printf "%s" "${a[1-1]}"', 'x'],
  ['a=(x y); i=1; printf "%s:%s" "${a[i]}" "${a[$i-1]}"', 'y:x'],
  ['a=(x y); i=0; printf "%s:%s" "${a[i++]}" "$i"', 'x:1'],
  ['a=(x y); printf "%s:%s" "${a[-1]}" "${a[-2]}"', 'y:x'],
  ['a=(x y); a[-1]=z; a[1-1]=q; printf "<%s>" "${a[@]}"', '<q><z>'],
  ['a[3]=x; printf "%s" "${a[1]:-default}"', 'default'],
  ['a=(x ""); set -u; printf "%s:%s:%s:%s" "${a[1]:-d}" "${a[1]:+s}" "${a[0]:+s}" "${a[2]-d}"', 'd::s:d'],
  ['a=(x); printf "%s" "${a[0]:-$(printf bad)}"', 'x'],
  ['a=(0 1); v=hello; i=1; printf "%s" "${v:${a[i]}:2}"', 'el'],
  ['a=(x y); i=0; printf "%s:%s" "${a[i++]:-d}" "$i"', 'x:1'],
  ['a=(a b c); n=1; printf "<%s>" "${a[@]:n:1+1}"', '<b><c>'],
] as const;

for (const [source, stdout] of cases) test(`indexed array compatibility: ${source}`, async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(source);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, stdout);
});

for (const source of [
  'a=(x y); a[]=z',
  'a=(x y); printf "%s" "${a[]}"',
  'a=(x y); printf "%s" "${a[-3]}"',
  'a=(x y); a[-3]=z',
  'a=(x y); a[2147483648]=z',
  'a=(x y); printf "%s" "${a[4294967296]}"',
  'a=(x y); printf "%s" "${a[@]:0:-1}"',
]) test(`indexed array compatibility keeps bounds: ${source}`, async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(source);
  assert.notEqual(result.exitCode, 0);
});

test("indexed slices preserve raw bytes and empty members", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [arraysExtension()] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec('a=(skip $\'\\xff\' "" end); printf "<%s>" "${a[@]:1:2}"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from([60, 255, 62, 60, 62]));
});

for (const extensions of [[], [arraysExtension()]]) test(`relative indexed reads and writes in ${extensions.length ? "extension" : "default"} profile`, async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec('a=(x y); a[-1]=z; printf "%s:%s" "${a[1-1]}" "${a[-1]}"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "x:z");
});
