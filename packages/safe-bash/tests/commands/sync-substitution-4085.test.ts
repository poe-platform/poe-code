import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { Runtime } from "../../src/shell/runtime.js";
import { registerYieldCheckpoint } from "../../src/contracts/yield.js";

for (const [setup, substitution, value] of [
  ['a=hello;', 'echo "x${a@U}"', 'xHELLO'],
  ['a=HELLO;', 'echo "${a@L}"', 'hello'],
  ['a=hello;', 'echo "${a@u}"', 'Hello'],
  ['a=hello;', 'echo "${a@Q}"', "'hello'"],
  ['prefix_one=1;', 'echo "x${!prefix_*}"', 'xprefix_one'],
  ['', 'echo "x$(echo y)"', 'xy'],
  ['a=hello;', 'printf "%s" "${a@U}"', 'HELLO'],
  ['a=HELLO;', 'dirname -- "/tmp/${a@L}/b"', '/tmp/hello'],
  ['a=HELLO;', 'basename -- "/tmp/${a@L}"', 'hello'],
  ['a=hello; f() { echo "$1"; };', 'f "${a@U}"', 'HELLO'],
] as const) {
  for (const mode of ['echo', 'assign', 'append'] as const) {
    test(`loop substitution ${mode}: ${substitution}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
      const body = mode === 'echo' ? `echo "$(${substitution})"` : `out${mode === 'append' ? '+' : ''}=$(${substitution})`;
      try {
        const result = await shell.exec(`${setup} out=; for i in 1 2; do ${body}; done; ${mode === 'echo' ? '' : 'printf "%s\\n" "$out"; declare -p out >/dev/null'}`);
        assert.equal(result.stdout, mode === 'echo' ? `${value}\n${value}\n` : `${mode === 'append' ? value + value : value}\n`);
        assert.equal(result.stderr, '');
        assert.equal(result.exitCode, 0);
      } finally { await shell.dispose(); }
    });
  }
}

for (const initialCommands of [124, 125, 126, 127]) {
  test(`loop substitutions cross yield checkpoints from command ${initialCommands}`, async context => {
    let checkpoints = 0;
    const runUnit = Runtime.prototype.runUnit;
    context.mock.method(Runtime.prototype, "runUnit", function (this: Runtime, ...args: Parameters<Runtime["runUnit"]>) {
      this.budget.commands = initialCommands;
      registerYieldCheckpoint(this.signal, () => { checkpoints++; });
      return runUnit.apply(this, args);
    });
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const result = await shell.exec('for i in {1..300}; do :; echo "$(echo "x$i")"; done');
      assert.equal(result.stdout, Array.from({ length: 300 }, (_, i) => `x${i + 1}\n`).join(''));
      assert.equal(result.stderr, '');
      assert.equal(result.exitCode, 0);
      assert.ok(checkpoints > 0);
    } finally { await shell.dispose(); }
  });
}

for (const loop of [
  'for ((i=0; i<2; i++)); do',
  'i=0; while ((i++ < 2)); do',
  'i=0; until ((i++ >= 2)); do',
  'for i in 1 2; do',
]) {
  test(`substitution preserves effects and mutable operands: ${loop}`, async () => {
    const source = `a=hello; out=; n=0; ${loop} n=$((n+1)); a="$a$i"; out+=$(echo "x$(echo "$a")"); echo "$(echo "x$(echo "$i")")"; done; printf "%s:%s\\n" "$n" "$out"; declare -p out`;
    const expected = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.equal(expected.error, undefined);
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const actual = await shell.exec(source);
      assert.equal(actual.stdout, expected.stdout);
      assert.equal(actual.stderr, expected.stderr);
      assert.equal(actual.exitCode, expected.status);
    } finally { await shell.dispose(); }
  });
}

test("Wave 125: sync factor, tsort, envsubst, hexdump -C, column -t, fold, expand, and unexpand in seq loops", async () => {
  const { factorCommands } = await import("../../src/commands/factor/index.js");
  const { tsortCommands } = await import("../../src/commands/tsort/index.js");
  const { envsubstCommands } = await import("../../src/commands/envsubst/index.js");
  const { hexdumpCommands } = await import("../../src/commands/hexdump/index.js");
  const { columnCommands } = await import("../../src/commands/column/index.js");
  const { foldCommands } = await import("../../src/commands/fold/index.js");
  const { standardCommands } = await import("../../src/commands/index.js");
  const shell = new Shell({ fs: new MemoryFileSystem() })
    .use(standardCommands())
    .use(factorCommands())
    .use(tsortCommands())
    .use(envsubstCommands())
    .use(hexdumpCommands())
    .use(columnCommands())
    .use(foldCommands());
  try {
    const rFactor = await shell.exec("for i in $(seq 10 15); do out=$(factor $((i * 12))); done; echo \"$out\"");
    assert.equal(rFactor.exitCode, 0);
    assert.equal(rFactor.stdout, "180: 2 2 3 3 5\n");

    const rFactorExp = await shell.exec("echo \"$(factor -h 720)\"");
    assert.equal(rFactorExp.exitCode, 0);
    assert.equal(rFactorExp.stdout, "720: 2^4 3^2 5\n");

    const rTsort = await shell.exec("for i in $(seq 1 5); do out=$(printf \"a b\\nb c\\nc d\\n\" | tsort | tr \"\\n\" \":\"); done; echo \"$out\"");
    assert.equal(rTsort.exitCode, 0);
    assert.equal(rTsort.stdout, "a:b:c:d:\n");

    const rEnvsubst = await shell.exec("export NAME=world ROLE=admin; for i in $(seq 1 5); do out=$(printf \"hello \\$NAME (\\$ROLE) #$i\" | envsubst); done; echo \"$out\"");
    assert.equal(rEnvsubst.exitCode, 0);
    assert.equal(rEnvsubst.stdout, "hello world (admin) #5\n");

    const rHexdump = await shell.exec("for i in $(seq 1 5); do out=$(printf \"abc$i\" | hexdump -C | head -n 1); done; echo \"$out\"");
    assert.equal(rHexdump.exitCode, 0);
    assert.equal(rHexdump.stdout, "00000000  61 62 63 35                                       |abc5|\n");

    const rColumn = await shell.exec("for i in $(seq 1 5); do out=$(printf \"id:val\\n$i:$((i*10))\\n\" | column -t -s : | tail -n 1); done; echo \"$out\"");
    assert.equal(rColumn.exitCode, 0);
    assert.equal(rColumn.stdout, "5   50\n");

    const rFold = await shell.exec("for i in $(seq 1 5); do out=$(printf \"item%02d\\n\" \"$i\" | fold -w 4 | tr \"\\n\" \":\"); done; echo \"$out\"");
    assert.equal(rFold.exitCode, 0);
    assert.equal(rFold.stdout, "item:05:\n");
  } finally {
    await shell.dispose();
  }
});

test("Wave 126: sync fmt, uname, id, whoami, hostname, and nproc in seq loops", async () => {
  const { standardCommands } = await import("../../src/commands/index.js");
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  try {
    const rUname = await shell.exec("for i in $(seq 1 5); do out=\"$(uname -s)-$(uname -m)-$i\"; done; echo \"$out\"");
    assert.equal(rUname.exitCode, 0);
    assert.equal(rUname.stdout, "Linux-x86_64-5\n");

    const rIdWhoami = await shell.exec("for i in $(seq 1 5); do out=\"$(id -u):$(whoami):$i\"; done; echo \"$out\"");
    assert.equal(rIdWhoami.exitCode, 0);
    assert.equal(rIdWhoami.stdout, "1000:sandbox:5\n");

    const rHostNproc = await shell.exec("for i in $(seq 1 5); do out=\"$(hostname):$(nproc):$i\"; done; echo \"$out\"");
    assert.equal(rHostNproc.exitCode, 0);
    assert.equal(rHostNproc.stdout, "sandbox:4:5\n");

    const rFmt = await shell.exec("for i in $(seq 1 5); do out=$(printf \"hello world $i foo bar\\n\" | fmt -w 12 | tr \"\\n\" \"|\"); done; echo \"$out\"");
    assert.equal(rFmt.exitCode, 0);
    assert.equal(rFmt.stdout, "hello world|5 foo bar|\n");
  } finally {
    await shell.dispose();
  }
});

test("Wave 127: sync sha256sum, md5sum, sha1sum, sha512sum, cksum, and base32 in seq loops", async () => {
  const { standardCommands } = await import("../../src/commands/index.js");
  const { byteCommands } = await import("../../src/commands/bytes/index.js");
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(byteCommands());
  try {
    const rSha256 = await shell.exec("for i in $(seq 1 5); do out=$(printf \"item-$i\" | sha256sum | cut -d\" \" -f1); done; echo \"$out\"");
    assert.equal(rSha256.exitCode, 0);
    assert.equal(rSha256.stdout, "fd9c86032838eb5e65d0f4ad6eb3af2d114ed16f4b729043cab3e2b7483decc9\n");

    const rMd5 = await shell.exec("for i in $(seq 1 5); do out=$(printf \"item-$i\" | md5sum | cut -d\" \" -f1); done; echo \"$out\"");
    assert.equal(rMd5.exitCode, 0);
    assert.equal(rMd5.stdout, "ad36abff56ce76a479dda134a3744c3b\n");

    const rSha1 = await shell.exec("for i in $(seq 1 5); do out=$(printf \"item-$i\" | sha1sum | cut -d\" \" -f1); done; echo \"$out\"");
    assert.equal(rSha1.exitCode, 0);
    assert.equal(rSha1.stdout, "daf0ac810772422088dbb6b77b3b29a64028b5b9\n");

    const rSha512 = await shell.exec("for i in $(seq 1 5); do out=$(printf \"item-$i\" | sha512sum | cut -d\" \" -f1); done; echo \"$out\"");
    assert.equal(rSha512.exitCode, 0);
    assert.equal(rSha512.stdout, "3552d85db804d10a0cdb2b4c32784798bd9b83ae77f43c83b6d74195a983b25990038dffc7670a82fb676697539e3e7fa68d774db36f5057ce0c8a22a769216d\n");

    const rCksum = await shell.exec("for i in $(seq 1 5); do out=$(printf \"item-$i\" | cksum); done; echo \"$out\"");
    assert.equal(rCksum.exitCode, 0);
    assert.equal(rCksum.stdout, "2112230944 6\n");

    const rBase32 = await shell.exec("for i in $(seq 1 5); do out=$(printf \"item-$i\" | base32 | base32 -d); done; echo \"$out\"");
    assert.equal(rBase32.exitCode, 0);
    assert.equal(rBase32.stdout, "item-5\n");
  } finally {
    await shell.dispose();
  }
});
