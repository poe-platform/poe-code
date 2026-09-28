import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { streamCommands } from "../../src/commands/streams.js";
import { predicateCommands } from "../../src/commands/predicates.js";

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

const printfFallbackCases = [
  ["zero-padded string", '"[%05s]\\n" "abc"'],
  ["large width", '"[%130s]\\n" "abc"'],
  ["large precision", '"[%.130s]\\n" "abc"'],
  ["octal argument", '"[%d]\\n" "$pad"'],
  ["hex argument", '"[%d]\\n" "$hex"'],
  ["signed unsigned conversions", '"[%u][%x][%X][%o]\\n" "$negative" "$positive" "$positive" "$negative"'],
  ["64-bit argument", '"[%d]\\n" "$big"'],
  ["negative zero", '"[%d][%i][%.0d][%.0i][%04d]\\n" "-0" "-0" "-0" "-0" "-0"'],
  ["UTF-8 precision", '"[%.1s][%5s]\\n" "$unicode" "$unicode"'],
] as const;

for (const [name, args] of printfFallbackCases) {
  for (const loop of ['for i in 1 2', 'for ((i=1;i<=2;i++))']) {
    for (const destination of ["stdout", "file", "variable"]) {
      test(`loop printf preserves ${name} through ${destination}: ${loop}`, async t => {
        const fs = new MemoryFileSystem();
        const shell = new Shell({ fs, commands: new CommandRegistry([...basicCommands(), ...streamCommands()]) });
        t.after(() => shell.dispose());
        const setup = `hex=0x10; negative=-1; positive=+10; big=1000000000000000; count=0; ${name === "UTF-8 precision" ? "unicode=é;" : ""}`;
        const before = `count=$((count+1)); ${name === "octal argument" ? 'printf -v pad "%04d" "$i";' : ""}`;
        const body = destination === "variable" ? `printf -v formatted ${args}; printf "%s" "$formatted"`
          : `printf ${args}${destination === "file" ? ' >> /result' : ''}`;
        const result = await shell.exec(`${setup} ${loop}; do ${before} ${body}; done; ${destination === "file" ? 'cat /result;' : ''} echo "count=$count"`);
        const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", `${setup} ${loop}; do ${before} printf ${args}; done; echo "count=$count"`]);
        assert.equal(native.error, undefined);
        assert.equal(result.exitCode, native.status, result.stderr);
        assert.equal(result.stderr, native.stderr.toString());
        assert.deepEqual(result.stdoutBytes, new Uint8Array(native.stdout));
      });
    }
  }
}

for (const loop of ['for i in 1 2', 'for ((i=1;i<=2;i++))']) {
  for (const predicate of ['[[ -s /result ]]', '[ -s /result ]']) {
    for (const redirect of [">", ">>"]) {
      test(`redirected loop exposes prior writes to ${predicate}: ${loop} ${redirect}`, async t => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/result", new Uint8Array());
        const shell = new Shell({ fs, commands: new CommandRegistry([...basicCommands(), ...predicateCommands()]) });
        t.after(() => shell.dispose());
        const result = await shell.exec(`${loop}; do echo "line:$i"; if ${predicate}; then echo "seen:$i"; fi; done ${redirect} /result`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, "");
        assert.equal(new TextDecoder().decode(await fs.readFile("/result")), "line:1\nseen:1\nline:2\nseen:2\n");
      });
    }
  }
}

for (const loop of [
  'for ((i=-2;i<0;i++))',
  'for ((i=start;i>limit;i--))',
  'for ((i=1;i>-4;i-=2))',
  'for ((i=1;i>-4;i=i-2))',
]) {
  for (const destination of ["stdout", "file", "variable"]) {
    test(`printf preserves signed induction operands through ${destination}: ${loop}`, async t => {
      const fs = new MemoryFileSystem();
      const shell = new Shell({ fs, commands: new CommandRegistry([...basicCommands(), ...streamCommands()]) });
      t.after(() => shell.dispose());
      const args = '"[%u][%x][%X][%o]\\n" "$i" "$i" "$i" "$i"';
      const body = destination === "variable" ? `printf -v formatted ${args}`
        : `printf ${args}${destination === "file" ? ' >> /result' : ''}`;
      const setup = 'start=-1; limit=-3;';
      const printVariable = destination === "variable" ? 'printf "%s" "$formatted";' : '';
      const result = await shell.exec(`${setup} ${loop}; do echo before; ${body}; done; ${destination === "file" ? 'cat /result;' : printVariable} echo finished`);
      const nativeBody = destination === "file" ? `printf -v formatted ${args}; output+=$formatted;` : `${body};`;
      const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", `${setup} output=; ${loop}; do echo before; ${nativeBody} done; ${destination === "file" ? 'printf "%s" "$output";' : printVariable} echo finished`], { encoding: "utf8" });
      assert.ifError(native.error);
      assert.equal(result.exitCode, native.status, result.stderr);
      assert.equal(result.stderr, native.stderr);
      assert.equal(result.stdout, native.stdout);
    });
  }
}

for (const body of [
  'echo "before:$i"; if [[ $i == 1 ]]; then echo "if:$i"; fi; echo "after:$i"',
  'echo "before:$i"; case "$i" in 1) echo "case:$i" ;; esac; echo "after:$i"',
  'echo "before:$i"; f "$i"; echo "after:$i"',
]) {
  test(`loop flush preserves compound output order: ${body}`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    t.after(() => shell.dispose());
    const source = `f() { echo "function:$1"; }; for ((i=1;i<=2;i++)); do ${body}; done; echo finished`;
    const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    const result = await shell.exec(source);
    assert.equal(result.exitCode, native.status, result.stderr);
    assert.equal(result.stderr, native.stderr);
    assert.equal(result.stdout, native.stdout);
  });
}

test("plain for loop flushes stdout before the next command", async t => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
  t.after(() => shell.dispose());
  const result = await shell.exec('for i in 1 2; do echo "line:$i"; done; echo finished');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "line:1\nline:2\nfinished\n");
});


for (const source of [
  'for value in 7 08; do printf "[%d]\\n" "$value"; done',
  'count=0; for i in 1 2; do printf "[%d][%d]\\n" "$((count+=1))" 0x10; done; echo "count=$count"',
  'for ((i=0;i<2;i++)); do printf "[%d]\\n" "$i$i"; done',
  'for ((i=0;i<2;i++)); do printf -v i "%s" 0x10; printf "[%d]\\n" "$i"; done',
  'for ((i=1999;i<=2000;i++)); do printf "[%04d][%s]\\n" "$i" "$i"; done',
  'v=abc; for ((i=1;i<=2;i++)); do echo before; x=${v:i=1000000000000000}; printf "[%d]\\n" "$i"; done; echo finished',
  'n=0; for ((i=1;i<=2;i++)); do echo before; n="i=1000000000000000"; ((x+=n)); printf "[%d]\\n" "$i"; done; echo finished',
  'n=0; for ((i=1;i<=2;i++)); do echo before; n="i=1000000000000000"; if ((n)); then echo yes; fi; printf "[%d]\\n" "$i"; done; echo finished',
  'a=(text); for ((i=1;i<=2;i++)); do echo before; x=${a[i=16]}; printf "[%d]\\n" "$i"; done; echo finished',
  'a=(x); v=abc; for ((i=1;i<=2;i++)); do echo before; a+=("${v:i=1000000000000000}"); printf "[%d]\\n" "$i"; done; echo finished',
  'for ((i=1;i<=2;i++)); do echo before; read -r i <<< 1000000000000000; printf "[%d]\\n" "$i"; done; echo finished',
  'for ((REPLY=1;REPLY<=2;REPLY++)); do echo before; read -r <<< 0x10; printf "[%d]\\n" "$REPLY"; done; echo finished',
  'start=1000000000000000; limit=1000000000000002; for ((i=start;i<limit;i++)); do echo before; printf "[%d]\\n" "$i"; done; echo finished',
  'for ((i=1;i<=2;i++)); do echo before; declare i=0x10; printf "[%d]\\n" "$i"; done; echo finished',
  'for ((i=1;i<=2;i++)); do echo before; export x=ok i=1000000000000000; printf "[%d]\\n" "$i"; done; echo finished',
  'for ((i=1;i<=2;i++)); do echo before; declare -i n="i=1000000000000000"; printf "[%d]\\n" "$i"; done; echo finished',
  'n="i=1000000000000000"; for ((i=1;i<=2;i++)); do echo before; declare -i x="$n"; printf "[%d]\\n" "$i"; done; echo finished',
  'for ((i=1;i<=2;i++)); do echo before; read -ra i <<< 1000000000000000; printf "[%d]\\n" "$i"; done; echo finished',
]) {
  test(`printf loop admission preserves values, effects, and status: ${source}`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    t.after(() => shell.dispose());
    const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.ifError(native.error);
    const result = await shell.exec(source);
    assert.equal(result.exitCode, native.status, result.stderr);
    assert.equal(result.stdout, native.stdout);
    if (native.stderr) assert.match(result.stderr, /printf:/);
    else assert.equal(result.stderr, "");
  });
}
