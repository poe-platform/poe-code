import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { streamCommands } from "../../src/commands/streams.js";
import { grepCommands } from "../../src/commands/grep.js";

for (const loop of ["for ((i=0;i<3;i++))", "for i in {0..2}"]) {
  for (const [name, body, expected] of [
    ["echo prefixes", 'echo "line_$(printf "item_%d\\n" "$i" | grep item_0)"', "line_item_0\nline_\nline_\n"],
    ["append", 'acc+="$(printf "item_%d\\n" "$i" | grep item_0)"; echo "$acc"', "item_0\nitem_0\nitem_0\n"],
    ["assignment prefixes", 'g="prefix_$(printf "item_%d\\n" "$i" | grep item_0)"; echo "$g"', "prefix_item_0\nprefix_\nprefix_\n"],
    ["count and status", 'g="$(printf "item_%d\\n" "$i" | grep -c item_0)"; echo "$?:$g"', "0:1\n1:0\n1:0\n"],
    ["empty output status", 'g="$(printf "item_%d\\n" "$i" | grep item_0)"; echo "$?:$g"', "0:item_0\n1:\n1:\n"],
    ["later pipeline status", 'g="$(printf "item_%d\\n" "$i" | grep item_0 | wc -l)"; echo "$?:$g"', "0:1\n0:0\n0:0\n"],
  ]) {
    test(`${loop} preserves grep ${name}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...basicCommands(), ...streamCommands(), ...grepCommands()]) });
      try {
        const result = await shell.exec(`acc=""; ${loop}; do ${body}; done`);
        assert.equal(result.stdout, expected);
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
      } finally { await shell.dispose(); }
    });
  }
}

test("arithmetic loop substitutions cross command checkpoints without corruption", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
  try {
    const result = await shell.exec('out=""; for ((i=1;i<=1800;i++)); do a=$(printf "%d" "$i"); b=$(printf "%d" "$i"); c=$(printf "%d" "$i"); d=$(printf "%d" "$i"); out+="$(printf "%d," "$i")"; done; echo "$a:$b:$c:$d"; echo "$out"');
    assert.equal(result.stdout, `1800:1800:1800:1800\n${Array.from({ length: 1800 }, (_, i) => `${i + 1},`).join("")}\n`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const flag of ["-q", "-v"]) {
  test(`grep ${flag} without a pattern rejects the invocation`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...basicCommands(), ...streamCommands(), ...grepCommands()]) });
    try {
      const result = await shell.exec(`for ((i=0;i<2;i++)); do g="$(printf '%s\\n' '${flag}' | grep ${flag})"; echo "$?:$g"; done`);
      assert.equal(result.stdout, "2:\n2:\n");
      assert.notEqual(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

for (const loop of ["for ((i=0;i<3;i++))", "for i in {0..2}"]) {
  for (const [body, tail, expected] of [
    ['acc+="$(printf "item_%d\\n" "$i" | grep item_0)"', 'echo "$acc"', "item_0\n"],
    ['g="prefix_$(printf "item_%d\\n" "$i" | grep item_0)"', 'echo "$g"', "prefix_\n"],
    ['g="$(printf "item_%d\\n" "$i" | grep -c item_0)"; acc="${acc}[$i:$g]"', 'echo "$acc"', "[0:1][1:0][2:0]\n"],
  ]) {
    test(`${loop} retains assignment output after synchronous execution: ${body}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...basicCommands(), ...grepCommands()]) });
      try {
        const result = await shell.exec(`acc=""; ${loop}; do ${body}; done; ${tail}`);
        assert.equal(result.stdout, expected);
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
      } finally { await shell.dispose(); }
    });
  }
}

for (const pipefail of [false, true]) {
  test(`zero-match grep pipeline preserves status with pipefail=${pipefail}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...basicCommands(), ...streamCommands(), ...grepCommands()]) });
    try {
      const result = await shell.exec(`${pipefail ? "set -o pipefail;" : ""} g="$(printf 'x\\n' | grep missing | wc -l)"; echo "$?:$g"`);
      assert.equal(result.stdout, `${pipefail ? 1 : 0}:0\n`);
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

test("ordinary for loop substitutions cross a pre-existing command checkpoint", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
  try {
    const result = await shell.exec('a=x; for ((j=0;j<1600;j++)); do a=x; b=x; c=x; d=x; e=x; done; out=""; for i in {1..150}; do a=$(printf "%d" "$i"); b=$(printf "%d" "$i"); c=$(printf "%d" "$i"); d=$(printf "%d" "$i"); out+="$a:$b:$c:$d:$(printf "%d," "$i")"; done; echo "$out"');
    assert.equal(result.stdout, `${Array.from({ length: 150 }, (_, i) => `${i + 1}:${i + 1}:${i + 1}:${i + 1}:${i + 1},`).join("")}\n`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});
