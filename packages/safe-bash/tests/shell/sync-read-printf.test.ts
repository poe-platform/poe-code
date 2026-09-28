import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { basicCommands } from "../../src/commands/basic.js";

const cases = [
  ["UTF-8 read", "", 'read a <<< "héllo"', 'a=$a', 'a=héllo'],
  ["escaped read", "", 'read a <<< \'a\\b\'', 'a=$a', 'a=ab'],
  ["multiline read", "s=$'l1\\nl2';", 'read a <<< "$s"', 'a=$a', 'a=l1'],
  ["allexport read", "set -a;", 'read a <<< "hello"', 'a=$a', 'a=hello'],
  ["lowercase read", "declare -l a;", 'read a <<< "HELLO"', 'a=$a', 'a=hello'],
  ["uppercase read", "declare -u a;", 'read a <<< "hello"', 'a=$a', 'a=HELLO'],
  ["nameref read", "declare -n ref=target;", 'read ref <<< "hello"', 'target=$target', 'target=hello'],
  ["exported array read", "export arr; declare -a arr;", 'read -a arr <<< "hello world"', 'arr=${arr[*]}', 'arr=hello world'],
  ["underscore read", "", 'read _ <<< "hello"', '', ''],
  ["lowercase printf", "declare -l out;", 'printf -v out "%s" "HELLO"', 'out=$out', 'out=hello'],
  ["uppercase printf", "declare -u out;", 'printf -v out "%s" "hello"', 'out=$out', 'out=HELLO'],
  ["array printf with attributes", "declare -i dummy=0; arr=(x y);", 'printf -v out "%s," "${arr[@]}"', 'out=$out', 'out=x,y,'],
] as const;

for (const [name, setup, command, output, expected] of cases) {
  for (const loop of [
    `for item in 1; do BODY; done`,
    `while ((i<1)); do BODY; done`,
    `until ((i>=1)); do BODY; done`,
    `for ((j=0;j<1;j++)); do BODY; done`,
  ]) {
    test(`${name} executes once in ${loop.split(" ")[0]}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
      try {
        const source = `${setup} i=0; ${loop.replace("BODY", `i=$((i+1)); ${command}`)}; echo "i=$i ${output}"`;
        const result = await shell.exec(source);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, `i=1 ${expected}\n`);
        if (!setup.includes("declare -l") && !setup.includes("declare -u") && !setup.includes("declare -n")) {
          const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
          assert.equal(native.error, undefined);
          assert.equal(result.stdout, native.stdout);
          assert.equal(result.stderr, native.stderr);
          assert.equal(result.exitCode, native.status);
        }
      } finally { await shell.dispose(); }
    });
  }
}

for (const [name, source, expected] of [
  ["changing read input", 's=hello; i=0; for item in 1 2; do i=$((i+1)); read a <<< "$s"; s=héllo; done; echo "$i:$a"', '2:héllo\n'],
  ["attributes introduced before printf", 'i=0; for item in 1; do i=$((i+1)); declare -l out; printf -v out "%s" HELLO; done; echo "$i:$out"', '1:hello\n'],
  ["IFS read", 'i=0; for item in 1; do i=$((i+1)); IFS=: read a b <<< "héllo:world"; done; echo "$i:$a:$b"', '1:héllo:world\n'],
] as const) {
  test(name, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected);
    } finally { await shell.dispose(); }
  });
}

for (const command of ['unset TARGET', 'printf -v TARGET "%s" new']) {
  for (const mode of ["unquoted", "quoted", "noglob", "no match", "expanded"]) {
    test(`${command} respects ${mode} pathname expansion`, async () => {
      const fs = new MemoryFileSystem();
      if (mode !== "no match") await fs.writeFile("/arr0", new Uint8Array());
      const shell = new Shell({ fs, cwd: "/", commands: new CommandRegistry(basicCommands()) });
      try {
        const target = mode === "quoted" ? "'arr[0]'" : mode === "expanded" ? "$target" : "arr[0]";
        const result = await shell.exec(`arr=(keep); arr0=old; target='arr[0]'; ${mode === "noglob" ? "set -f;" : ""} ${command.replace("TARGET", target)}; echo "arr=${'${arr[0]}'} arr0=$arr0"`);
        const globbed = mode === "unquoted" || mode === "expanded";
        const assigned = command.startsWith("printf") ? "new" : "";
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, globbed ? `arr=keep arr0=${assigned}\n` : `arr=${assigned} arr0=old\n`);
      } finally { await shell.dispose(); }
    });
  }
}

for (const setup of ["export arr; declare -a arr", "arr=(old); export arr", "declare -ax arr"]) {
  test(`read preserves the array export attribute: ${setup}`, async () => {
    const commands = new CommandRegistry(basicCommands());
    commands.register({ name: "inspect-env", execute({ env }) {
      assert.equal(env.arr, undefined, "Bash does not export array values to commands");
      return { exitCode: 0 };
    } });
    const shell = new Shell({ fs: new MemoryFileSystem(), commands });
    try {
      const result = await shell.exec(`${setup}; read -a arr <<< "hello world"; declare -p arr; inspect-env`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, 'declare -ax arr=([0]="hello" [1]="world")\n');
    } finally { await shell.dispose(); }
  });
}
