import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { standardCommands } from "../../src/commands/index.js";

for (const [disable, enable] of [["+h", "-h"], ["+o hashall", "-o hashall"]]) {
  test(`set ${disable} disables hashing until set ${enable}`, async t => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/a");
    await fs.writeFile("/a/tool", new TextEncoder().encode("#!/bin/sh\necho A\n"), { mode: 0o755 });
    const shell = new Shell({ fs, env: { PATH: "/a" } }).use(standardCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(`set ${disable}; echo "disable=$?"; tool; hash -t tool; echo "lookup=$?"; set ${enable}; echo "enable=$?"; hash -t tool 2>/dev/null; echo "before=$?"; tool; hash -t tool`);
    assert.equal(result.stdout, "disable=0\nA\nlookup=1\nenable=0\nbefore=1\nA\n/a/tool\n");
    assert.equal(result.stderr, "shell: line 1: hash: hashing disabled\n");
    assert.equal(result.exitCode, 0);
  });
}

for (const operation of ["hash", "hash -l", "hash -r", "hash -d saved", "hash -p /other saved", "hash -t saved", "hash saved", "hash -z"]) {
  test(`${operation} reports disabled hashing and preserves saved entries`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(`hash -p /saved saved; set +h; ${operation}; echo "disabled=$?"; set -h; hash -t saved`);
    assert.equal(result.stdout, "disabled=1\n/saved\n");
    assert.equal(result.stderr, "shell: line 1: hash: hashing disabled\n");
    assert.equal(result.exitCode, 0);
  });
}

test("disabled hashing bypasses pinned commands without replacing their entries", async t => {
  const fs = new MemoryFileSystem();
  for (const directory of ["a", "b"]) {
    await fs.mkdir(`/${directory}`);
    await fs.writeFile(`/${directory}/tool`, new TextEncoder().encode(`#!/bin/sh\necho ${directory}\n`), { mode: 0o755 });
  }
  const shell = new Shell({ fs, env: { PATH: "/a" } }).use(standardCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec("hash -p /b/tool tool; set +h; tool; command -v tool; type -p tool; set -h; hash -t tool; tool");
  assert.equal(result.stdout, "a\n/a/tool\n/a/tool\n/b/tool\nb\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

for (const invocation of ["bash +h /script", "bash +o hashall /script", "bash +h -s"]) {
  test(`${invocation} applies hashall to script files and standard input`, async t => {
    const fs = new MemoryFileSystem();
    const source = 'shopt -qo hashall; echo "hashing=$?"';
    await fs.writeFile("/script", new TextEncoder().encode(source));
    const shell = new Shell({ fs }).use(standardCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(invocation, { stdin: source });
    assert.equal(result.stdout, "hashing=1\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

test("hashall is visible through option queries, flags and local option restoration", async t => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec('case $- in *h*) echo enabled;; esac; [[ -o hashall ]]; echo "conditional=$?"; test -o hashall; echo "test=$?"; f() { local -; set +h; shopt -qo hashall; echo "local=$?"; }; f; shopt -qo hashall; echo "restored=$?"; set +h; case $- in *h*) echo BAD;; esac; [[ -o hashall ]]; echo "conditional=$?"; test -o hashall; echo "test=$?"; set -o; set +o');
  assert.ok(result.stdout.startsWith("enabled\nconditional=0\ntest=0\nlocal=1\nrestored=0\nconditional=1\ntest=1\n"), result.stdout);
  assert.ok(result.stdout.includes("hashall\toff\n"));
  assert.ok(result.stdout.includes("set +o hashall\n"));
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("subshells inherit hashall while fresh interpreters default to hashing", async t => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec("set +h; (hash -t saved; set -h); hash -t saved; bash -c 'shopt -qo hashall; echo fresh=$?'; bash +h -c 'shopt -qo hashall; echo child=$?'; set -h; (set +h); shopt -qo hashall; echo parent=$?");
  assert.equal(result.stdout, "fresh=0\nchild=1\nparent=0\n");
  assert.equal(result.stderr, "shell: line 1: hash: hashing disabled\nshell: line 1: hash: hashing disabled\n");
  assert.equal(result.exitCode, 0);
});

test("sessions preserve the hashall option across executions", async t => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  t.after(() => shell.dispose());
  const session = shell.createSession();
  assert.equal((await session.exec("set +h")).exitCode, 0);
  const disabled = await session.exec("hash -t saved");
  assert.equal(disabled.exitCode, 1);
  assert.equal(disabled.stderr, "shell: line 1: hash: hashing disabled\n");
  const enabled = await session.exec("set -h; hash -p /saved saved; hash -t saved");
  assert.equal(enabled.stdout, "/saved\n");
  assert.equal(enabled.stderr, "");
  assert.equal(enabled.exitCode, 0);
});

test("independent executions start with hashing enabled", async t => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  t.after(() => shell.dispose());
  for (let run = 0; run < 3; run++) {
    assert.equal((await shell.exec("set +h")).exitCode, 0);
    assert.equal((await shell.exec("test -o hashall")).exitCode, 0);
  }
});

test("SHELLOPTS reflects hashing toggles", async t => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec('echo "$SHELLOPTS"; set +h; echo "$SHELLOPTS"; set -h; echo "$SHELLOPTS"');
  assert.equal(result.stdout, "braceexpand:hashall\nbraceexpand\nbraceexpand:hashall\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});
