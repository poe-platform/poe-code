import assert from "node:assert/strict";
import test from "node:test";
import { Shell, createMemoryFileSystem, agentCommands, createAgentCommands, bcCommands, spongeCommands, fdCommands, lessCommands } from "../../src/index.js";

test("xxd and od hex/byte inspection and roundtrip reversal", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  await fs.mkdir("/work", { recursive: true });
  try {
    const r1 = await shell.exec(`
printf 'Hello, World!' | xxd -p
printf '48656c6c6f2c20576f726c6421' | xxd -r -p
printf '\\n'
printf 'ABCD' | od -An -t x1 | tr -s ' '
`);
    assert.equal(r1.stderr, "");
    assert.equal(r1.exitCode, 0);
    assert.equal(r1.stdout, "48656c6c6f2c20576f726c6421\nHello, World!\n 41 42 43 44\n");
  } finally {
    await shell.dispose();
  }
});

test("bc arbitrary-precision arithmetic, -l mathlib, base conversion, loops, and user functions", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  await fs.mkdir("/work", { recursive: true });
  try {
    const r1 = await shell.exec(`
echo "2 + 3 * 4" | bc
echo "scale=4; 22 / 7" | bc
echo "scale=6; sqrt(2)" | bc
echo "obase=16; 255" | bc
echo "ibase=16; FF" | bc
echo "define fact(n) { if (n <= 1) return 1; return n * fact(n - 1); } fact(10)" | bc
echo "s=0; for (i=1; i<=100; i++) s += i; s" | bc
`);
    assert.equal(r1.stderr, "");
    assert.equal(r1.exitCode, 0);
    assert.equal(
      r1.stdout,
      "14\n3.1428\n1.414213\nFF\n255\n3628800\n5050\n"
    );

    const mathRes = await shell.exec(`echo "4 * a(1)" | bc -l`);
    assert.equal(mathRes.stderr, "");
    assert.equal(mathRes.exitCode, 0);
    assert.match(mathRes.stdout.trim(), /^3\.141592653589/u);
  } finally {
    await shell.dispose();
  }
});

test("sponge soaks all stdin before modifying target file in-place and supports -a", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  await fs.mkdir("/work", { recursive: true });
  await fs.writeFile("/work/data.txt", Buffer.from("gamma\nalpha\nbeta\nalpha\n"));
  try {
    const res = await shell.exec(`
sort data.txt | uniq | sponge data.txt
cat data.txt
printf 'delta\\n' | sponge -a data.txt
cat data.txt
`);
    assert.equal(res.stderr, "");
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "alpha\nbeta\ngamma\nalpha\nbeta\ngamma\ndelta\n"
    );
  } finally {
    await shell.dispose();
  }
});

test("fd finds files with regex/glob, extensions (-e), types (-t), hidden (-H), excludes (-E), and exec (-x/-X)", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  await fs.mkdir("/work/src/components", { recursive: true });
  await fs.mkdir("/work/src/utils", { recursive: true });
  await fs.mkdir("/work/.git", { recursive: true });
  await fs.writeFile("/work/src/components/Button.tsx", Buffer.from("export const Button = 1;"));
  await fs.writeFile("/work/src/components/Button.test.tsx", Buffer.from("test"));
  await fs.writeFile("/work/src/utils/math.ts", Buffer.from("export const add = 1;"));
  await fs.writeFile("/work/.env", Buffer.from("SECRET=1"));
  await fs.writeFile("/work/.git/config", Buffer.from("git"));
  try {
    const r1 = await shell.exec(`
fd -e ts -e tsx -E '*.test.tsx'
printf -- '---\\n'
fd -H '^\\.env$'
printf -- '---\\n'
fd -t d
printf -- '---\\n'
fd -e ts -x printf 'stem:%s\\n' '{/.}'
`);
    assert.equal(r1.stderr, "");
    assert.equal(r1.exitCode, 0);
    assert.equal(
      r1.stdout,
      "src/components/Button.tsx\nsrc/utils/math.ts\n---\n.env\n---\nsrc\nsrc/components\nsrc/utils\n---\nstem:math\n"
    );
  } finally {
    await shell.dispose();
  }
});

test("less and more act as non-interactive pass-throughs with -N, -s, and +pattern support", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  await fs.mkdir("/work", { recursive: true });
  await fs.writeFile("/work/log.txt", Buffer.from("line1\n\n\nline2\nline3\n"));
  try {
    const res = await shell.exec(`
printf 'hello from pipeline\\n' | less -R -F -X
less -s log.txt
less -N +/line2 log.txt
more -d log.txt | wc -l | tr -d ' '
`);
    assert.equal(res.stderr, "");
    assert.equal(res.exitCode, 0);
    assert.equal(
      res.stdout,
      "hello from pipeline\nline1\n\nline2\nline3\n     4  line2\n     5  line3\n5\n"
    );
  } finally {
    await shell.dispose();
  }
});

test("muscleMemoryCommands plugin and agentCommands({ muscleMemory: true }) register explicitly", async () => {
  const explicit = createAgentCommands({ muscleMemory: true }).map(c => c.name);
  for (const name of ["bc", "sponge", "fd", "less", "more"]) {
    assert.ok(explicit.includes(name), `expected ${name} in createAgentCommands({ muscleMemory: true })`);
  }
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(bcCommands()).use(spongeCommands()).use(fdCommands()).use(lessCommands());
  try {
    const res = await shell.exec(`bc <<< "6 * 7"`);
    assert.equal(res.stdout, "42\n");
  } finally {
    await shell.dispose();
  }
});

test("fd -q, -S, -C, --strip-cwd-prefix, --and, and bc -e / less -p parity", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work/pkg/sub", { recursive: true });
  await fs.writeFile("/work/pkg/small.ts", new TextEncoder().encode("const x = 1;\n"));
  await fs.writeFile("/work/pkg/large.ts", new TextEncoder().encode("x".repeat(500) + "\n"));
  await fs.writeFile("/work/pkg/sub/match_target.ts", new TextEncoder().encode("alpha\nbeta_marker\ngamma\n"));

  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());

  // fd -q / --has-results
  const qHit = await shell.exec("fd -q large");
  assert.equal(qHit.exitCode, 0);
  assert.equal(qHit.stdout, "");
  const qMiss = await shell.exec("fd -q nonexistent_xyz");
  assert.equal(qMiss.exitCode, 1);

  // fd -S size filtering + -C base directory + --strip-cwd-prefix + --and
  const sizeRes = await shell.exec("fd -C /work/pkg --strip-cwd-prefix -S +100b --and large .");
  assert.equal(sizeRes.exitCode, 0);
  assert.equal(sizeRes.stdout.trim(), "large.ts");

  // bc -e / --expression
  const bcRes = await shell.exec("bc -l -e 'scale=3; 22/7' -e '2^10'");
  assert.equal(bcRes.exitCode, 0);
  assert.deepEqual(bcRes.stdout.trim().split("\n"), ["3.142", "1024"]);

  // less -RFX -p pattern
  const lessRes = await shell.exec("less -RFX -p beta_marker /work/pkg/sub/match_target.ts");
  assert.equal(lessRes.exitCode, 0);
  assert.equal(lessRes.stdout, "beta_marker\ngamma\n");
});
