import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { basicCommands } from "../../src/commands/basic.js";

const cases = [
  ["empty fields preserve registers", 'for z in {1..5}; do w=$((z + 10)); done; x=keep_x; y=77; items=""; for x in $items; do y=$((x + 1)); done; echo "x=$x y=$y"', "x=keep_x y=77\n"],
  ["empty slice preserves registers", 'arr=(1 2); x=keep; y=77; for x in "${arr[@]:5:2}"; do y=$((x + 1)); done; echo "$x:$y"', "keep:77\n"],
  ["function reads array subscripts", 'arr=(10 20 30); total=0; add_item() { (( total += arr[i] )); }; for i in {0..2}; do add_item; done; echo "total=$total"', "total=60\n"],
  ["function redefinition invalidates compiled body", 'out=""; for round in 1 2; do if [[ $round == 1 ]]; then cb() { out+="A$1 "; }; else cb() { out+="B$1 "; }; fi; for i in {1..2}; do cb "$i"; done; done; echo "$out"', "A1 A2 B1 B2 \n"],
  ["function stdout follows preceding echo", 'f() { echo "in $1"; }; for ((i=0; i<2; i++)); do echo "before $i"; f "$i"; done', "before 0\nin 0\nbefore 1\nin 1\n"],
  ["function append redirect", 'f() { echo "v:$1" >> /out1; }; for i in {1..2}; do f "$i"; done; echo "$(</out1)"', "v:1\nv:2\n"],
  ["redirect parameter expansions", 'arr=(alpha beta); for i in {0..1}; do echo "v:${unset_var:-DEF_$i}:${#i}:${arr[i]}" >> /out3; done; echo "$(</out3)"', "v:DEF_0:1:alpha\nv:DEF_1:1:beta\n"],
  ["nested coalesced redirects", 'f() { echo "first:$1" > /out; echo "second:$1" >> /out; echo "discard:$1" > /dev/null; }; for i in {1..2}; do f "$i"; done; echo "$(</out)"', "first:2\nsecond:2\n"],
  ["arithmetic function redirects", 'f() { echo "v:$1" >> /out; }; for ((i=0;i<2;i++)); do f "$i"; done; echo "$(</out)"', "v:0\nv:1\n"],
  ["redirect target expansions", 'for i in {0..1}; do echo "v:$i" > "/file_${missing:-$i}_${#i}"; done; echo "$(</file_0_1)|$(</file_1_1)"', "v:0|v:1\n"],
  ["directory redirect target expansions", 'arr=(alpha beta); for i in {0..1}; do echo "v:$i" > "/dir/file_${arr[i]}_${#i}"; done; echo "$(</dir/file_alpha_1)|$(</dir/file_beta_1)"', "v:0|v:1\n"],
] as const;
for (const [name, source, expected] of cases) test(name, async () => {
  // File redirects use the virtual filesystem; never run those against the host.
  if (!source.includes("/out") && !source.includes("/file_")) {
    const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.equal(native.status, 0, native.stderr);
    assert.equal(native.stdout, expected);
  }
  const fs = new MemoryFileSystem();
  await fs.mkdir("/dir");
  const shell = new Shell({ fs });
  for (const command of basicCommands()) shell.commands.register(command);
  try {
    const result = await shell.exec(source);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

const wave86Cases = [
  ['literal numeric variable bound', 'N=3; S=1; for ((i=0;i<N;i+=S)); do echo "$i"; done'],
  ['options stop after operand', String.raw`flag=-e; for ((i=0;i<2;i++)); do echo -n value "$flag" "a\nb"; done`],
  ['bare read bound', 'a=(2); REPLY=2; for ((i=0;i<REPLY;i++)); do read -r <<< a; echo "iter:$i"; done'],
  ['else bound', 'a=(2); N=2; for ((i=0;i<N;i++)); do if ((i!=0)); then :; else N=a; fi; echo "iter:$i"; done'],
  ['quoted escape options', String.raw`for ((i=0;i<2;i++)); do echo "-e" "a\nb"; echo "-ne" "c\nd:"; done`],
  ['expanded options after -n', String.raw`flag=-e; for ((i=0;i<2;i++)); do echo -n "$flag" "a\nb:"; done`],
  ['quoted option prefix', String.raw`flag=e; for ((i=0;i<2;i++)); do echo -E "-$flag" "a\nb"; done`],
  ...['a', 'a[0 + 0 + 0]'].flatMap(reference => [
    ['if bound', `a=(2); N=2; for ((i=0;i<N;i++)); do if ((i==0)); then N="${reference}"; fi; echo "iter:$i"; done`],
    ['case stride', `a=(1); S=1; for ((i=0;i<2;i+=S)); do case $i in 0) S="${reference}";; esac; echo "iter:$i"; done`],
    ['read bound', `a=(2); N=2; for ((i=0;i<N;i++)); do read -r N <<< "${reference}"; echo "iter:$i"; done`],
    ['function bound', `a=(2); N=2; f() { N="${reference}"; }; for ((i=0;i<N;i++)); do f; echo "iter:$i"; done`],
    ['nested writes bound', `a=(2); N=2; for ((i=0;i<N;i++)); do for j in 1; do N="${reference}"; done; echo "iter:$i"; done`],
    ['nested variable bound', `a=(2); N=2; for outer in 1 2; do for ((i=0;i<N;i++)); do if ((i==0)); then N="${reference}"; fi; echo "iter:$i"; done; done`],
  ]),
] as const;
for (const [name, source] of wave86Cases) test(`wave 86: ${name}: ${source}`, async () => {
  const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
  assert.equal(native.status, 0, native.stderr);
  const shell = new Shell({ fs: new MemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  try {
    const result = await shell.exec(source);
    assert.equal(result.stdout, native.stdout);
    assert.equal(result.stderr, native.stderr);
    assert.equal(result.exitCode, native.status);
  } finally { await shell.dispose(); }
});
