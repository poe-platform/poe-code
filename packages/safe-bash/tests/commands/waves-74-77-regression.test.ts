import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createByteCommands } from "../../src/commands/bytes/index.js";
import { createStreamFormatCommands } from "../../src/commands/stream-format/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const cases = [
  ['branch redirects', 'for ((i=1;i<=2;i++)); do if ((i==1)); then echo "hello_$i" > /f; else echo "hello_$i" >> /f; fi; done; cat /f', 'hello_1\nhello_2\n'],
  ['branch discard', 'for ((i=1;i<=2;i++)); do if ((i==1)); then echo hidden >/dev/null; else echo visible; fi; done', 'visible\n'],
  ['ordered branch stdout', 'for ((i=1;i<=2;i++)); do echo "before_$i"; if ((i==1)); then echo "inside_$i"; fi; done', 'before_1\ninside_1\nbefore_2\n'],
  ['while completion', 'i=0; while ((i<3000)); do i=$((i+1)); done; echo "$i"', '3000\n'],
  ['until completion', 'i=0; until ((i>=3000)); do i=$((i+1)); done; echo "$i"', '3000\n'],
  ['tr range here string', 'v=$(tr -d "0-9" <<< "abc123xyz"); echo "$v"', 'abcxyz\n'],
  ['tr range file', 'echo abc123xyz > /f; v=$(tr -d "0-9" < /f); echo "$v"', 'abcxyz\n'],
  ['nl blank lines', 'v=$(nl <<< $\'a\\n\\nb\'); echo "$v"', '     1\ta\n       \n     2\tb\n'],
  ['nl blank lines from file', 'printf "a\\n\\nb\\n" >/f; v=$(nl < /f); echo "$v"', '     1\ta\n       \n     2\tb\n'],
  ['nested elif redirects', 'for ((i=1;i<=3;i++)); do if ((i==1)); then echo first >/f; elif ((i==2)); then if ((i==2)); then echo second >>/f; fi; else echo third >>/f; fi; done; cat /f', 'first\nsecond\nthird\n'],
  ['ordered case stdout', 'for ((i=1;i<=2;i++)); do echo "before_$i"; case "$i" in 1) echo inside;; esac; done', 'before_1\ninside\nbefore_2\n'],
  ['tr range pipeline', 'v=$(echo abc123xyz | tr -d "0-9"); echo "$v"', 'abcxyz\n'],
  ['base64 wrapping', `v=$(base64 <<< "${'a'.repeat(90)}"); echo "$v"`, Buffer.from('a'.repeat(90)+'\n').toString('base64').match(/.{1,76}/g)!.join('\n')+'\n'],
] as const;
for (const [name, source, expected] of cases) test(name, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createByteCommands(), ...createStreamFormatCommands()]) });
  try {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  } finally { await shell.dispose(); }
});
for (const loop of ['while ((i<3000))', 'until ((i>=3000))']) test(`${loop} enforces loop budget`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()), limits: { maxLoopIterations: 10 } });
  try {
    await assert.rejects(shell.exec(`i=0; ${loop}; do i=$((i+1)); done`), /maxLoopIterations/);
  } finally { await shell.dispose(); }
});
test('branch stdout enforces output budget', async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()), limits: { maxOutputBytes: 5 } });
  try {
    await assert.rejects(shell.exec('for ((i=1;i<=2;i++)); do if ((i==1)); then echo abcdef; fi; done'), /maxOutputBytes/);
  } finally { await shell.dispose(); }
});
test('base64 here strings encode and decode without global Buffer', async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createByteCommands()]) });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Buffer')!;
  Object.defineProperty(globalThis, 'Buffer', { configurable: true, value: undefined });
  try {
    const encoded = await shell.exec('v=$(base64 <<< hello); echo "$v"');
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    assert.equal(encoded.stdout, 'aGVsbG8K\n');
    const decoded = await shell.exec('v=$(base64 -d <<< aGVsbG8K); echo "$v"');
    assert.equal(decoded.exitCode, 0, decoded.stderr);
    assert.equal(decoded.stdout, 'hello\n');
  } finally {
    Object.defineProperty(globalThis, 'Buffer', descriptor);
    await shell.dispose();
  }
});
test('substitution reads respect filesystem budget', async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createByteCommands(), ...createStreamFormatCommands()]), limits: { maxFileSystemOperations: 5 } });
  try {
    await assert.rejects(shell.exec('echo value > /f; for ((i=1;i<=50;i++)); do v=$(cat /f); done'), /maxFileSystemOperations/);
  } finally { await shell.dispose(); }
});

import { spawnSync } from "node:child_process";

test("Wave 86: variable-bound, stride, countdown arithmetic-for, echo -n/multi-arg, and read <<< in trySyncLoop", async () => {
  const source = `
    mkdir -p /tmp
    n=25
    sum1=0
    for ((i = 0; i < n; i++)); do
      ((sum1 += i))
    done
    sum2=0
    for ((j = 0; j < 30; j += 3)); do
      ((sum2 += j))
    done
    sum3=0
    for ((k = 12; k > 0; k--)); do
      ((sum3 += k))
    done
    echo -n "S:$sum1:$sum2:$sum3:$i:$j:$k|"
    for ((m = 0; m < 4; m++)); do
      echo -n "$m,"
      echo "$m" "$((m * 10))" "$((m * 100))" >> /tmp/w86_echo.txt
    done
    echo ""
    items=("alpha:10:x" "beta:20:y" "gamma:30:z")
    rsum=0
    for item in "\${items[@]}"; do
      IFS=: read -r rk rv rrest <<< "$item"
      ((rsum += rv))
      echo "$rk=$rv($_)" >> /tmp/w86_echo.txt
    done
    echo "R:$rsum:$rk:$rv:$rrest"
    cat /tmp/w86_echo.txt
    rm -f /tmp/w86_echo.txt
  `;
  const oracle = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
  assert.equal(oracle.status, 0, oracle.stderr);
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createByteCommands(), ...createStreamFormatCommands()]) });
  try {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, oracle.stdout);
  } finally {
    await shell.dispose();
  }
});

test("Wave 87: unquoted $(seq)/$(cat) for-loops, [[ =~ ]] + BASH_REMATCH[1], and unset in trySyncLoop", async () => {
  const source = `
    mkdir -p /tmp
    sum1=0
    for i in $(seq 1 30); do
      ((sum1 += i))
    done
    sum2=0
    for j in $(seq 2 3 40); do
      ((sum2 += j))
    done
    printf "%s\\n" 10 20 30 40 50 > /tmp/w87_nums.txt
    sum3=0
    for x in $(cat /tmp/w87_nums.txt); do
      ((sum3 += x))
    done
    rm -f /tmp/w87_nums.txt
    rmatch_sum=0
    for ((k = 0; k < 15; k++)); do
      w="key_$((k * 4))"
      if [[ $w =~ ^key_([0-9]+)$ ]]; then
        ((rmatch_sum += BASH_REMATCH[1]))
      fi
      tmp="val_$k"
      unset tmp
    done
    echo "W87:$sum1:$sum2:$sum3:$rmatch_sum:\${tmp:-UNSET}:\${BASH_REMATCH[1]}"
  `;
  const oracle = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
  assert.equal(oracle.status, 0, oracle.stderr);
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createByteCommands(), ...createStreamFormatCommands()]) });
  try {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, oracle.stdout);
  } finally {
    await shell.dispose();
  }
});

test("Wave 88: nested for over $var/$(seq)/multi-word, local/declare/export, and shift in (($# > 0)) in trySyncLoop", async () => {
  const fs = new MemoryFileSystem();
  const registry = new CommandRegistry();
  for (const cmd of createStandardCommands()) registry.register(cmd);
  for (const cmd of createByteCommands()) registry.register(cmd);
  for (const cmd of createStreamFormatCommands()) registry.register(cmd);
  const shell = new Shell({ fs, commands: registry });

  const r1 = await shell.exec(`
    rows="r1 r2 r3 r4"
    cols="c1 c2 c3"
    acc=""
    for r in $rows; do
      for c in $cols; do
        acc+="\${r}_\${c},"
      done
    done
    echo "$acc"
  `);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, "r1_c1,r1_c2,r1_c3,r2_c1,r2_c2,r2_c3,r3_c1,r3_c2,r3_c3,r4_c1,r4_c2,r4_c3,\n");

  const r2 = await shell.exec(`
    sum=0
    for r in $(seq 1 5); do
      for c in $(seq 1 4); do
        for k in 10 20; do
          ((sum += r * c + k))
        done
      done
    done
    echo "$sum"
  `);
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.stdout, "900\n");

  const r3 = await shell.exec(`
    sq=999
    f() {
      local sum=0
      for ((i=1; i<=10; i++)); do
        local sq=$((i * i))
        declare step=1
        export EXP_LAST="v_$i"
        printf -v fmt "%02d" "$i"
        ((sum += sq + step))
      done
      echo "$sum:$sq:$fmt:$EXP_LAST"
    }
    f
    echo "outer:$sq:$EXP_LAST"
  `);
  assert.equal(r3.exitCode, 0);
  assert.equal(r3.stdout, "395:100:10:v_10\nouter:999:v_10\n");

  const r4 = await shell.exec(`
    set -- $(seq 1 20)
    sum=0
    while (($# > 0)); do
      if (($1 % 2 == 0)); then
        ((sum += $1))
      fi
      shift
    done
    echo "$sum:$#"
  `);
  assert.equal(r4.exitCode, 0);
  assert.equal(r4.stdout, "110:0\n");
});
