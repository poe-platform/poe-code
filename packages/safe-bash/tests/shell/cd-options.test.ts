import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, MemoryFileSystem, FsError, agentCommands } from "../../src/index.js";

async function fixture() {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work/dir/child", { recursive: true });
  await fs.mkdir("/work/-P");
  await fs.mkdir("/search", { recursive: true });
  await fs.symlink("/work/dir/child", "/search/link");
  await fs.symlink("dir/child", "/work/link");
  const shell = new Shell({ fs, cwd: "/work", env: { HOME: "/work/link", OLDPWD: "/search/link" } }).use(agentCommands());
  return { fs, shell };
}

for (const [before, command, destination, stack] of [
  ["", "cd dir", "/work/dir", "/work/dir\n"],
  ["", "cd -P link", "/work/dir/child", "/work/dir/child\n"],
  ["", "pushd dir", "/work/dir", "/work/dir\n"],
  ["pushd -n /work/dir >/dev/null;", "pushd", "/work/dir", "/work/dir\n/work\n"],
  ["pushd -n /work/dir >/dev/null;", "popd", "/work/dir", "/work/dir\n/work/dir\n"],
] as const) {
  for (const binding of ["OLDPWD", "PWD", "OLDPWD PWD"]) {
    test(`${command} changes directory despite readonly ${binding}`, async context => {
      const { fs, shell } = await fixture();
      context.after(() => shell.dispose());
      await fs.writeFile(`${destination}/marker`, new TextEncoder().encode("entered\n"));
      const result = await shell.exec(`${before} readonly ${binding}; ${command}; printf 'rc=%s|%s|%s\\n' "$?" "$PWD" "$OLDPWD"; pwd; pwd -P; cat marker; dirs -l -p`);
      assert.equal(result.exitCode, 0);
      const pwd = binding === "OLDPWD" ? destination : "/work";
      const oldpwd = binding === "PWD" ? "/work" : "/search/link";
      assert.equal(result.stdout, `rc=1|${pwd}|${oldpwd}\n${destination}\n${destination}\nentered\n${stack}`);
      assert.equal(result.stderr, binding.split(" ").map(name => `shell: line 1: ${name}: readonly variable\n`).join(""));
    });
  }
}

test("cd updates PWD when unsetting readonly OLDPWD fails", async context => {
  const { shell } = await fixture();
  context.after(() => shell.dispose());
  const result = await shell.exec('unset PWD; readonly OLDPWD; cd dir; printf "%s|%s|%s|" "$?" "$PWD" "$OLDPWD"; pwd');
  assert.equal(result.stdout, "1|/work/dir|/search/link|/work/dir\n");
  assert.equal(result.stderr, "shell: line 1: OLDPWD: readonly variable\n");
});

test("cd to a missing directory fails before readonly variable updates", async context => {
  const { shell } = await fixture();
  context.after(() => shell.dispose());
  const result = await shell.exec('readonly PWD OLDPWD; cd missing; printf "%s|%s|%s|" "$?" "$PWD" "$OLDPWD"; pwd');
  assert.equal(result.stdout, "1|/work|/search/link|/work\n");
  assert.equal(result.stderr, "shell: line 1: cd: missing: No such file or directory\n");
});

for (const [before, command, previous, destination] of [
  ["", "cd dir", "/work", "/work/dir"],
  ["", "cd -P link", "/work", "/work/dir/child"],
  ["", "pushd dir >/dev/null", "/work", "/work/dir"],
  ["pushd dir >/dev/null;", "popd >/dev/null", "/work/dir", "/work"],
] as const) {
  for (const [setup, pwdFlag, oldpwdFlag] of [
    [":", "-x", "-x"],
    ["export -n PWD OLDPWD", "--", "--"],
    ["export -n PWD", "--", "-x"],
    ["export -n OLDPWD", "-x", "--"],
    ["unset OLDPWD", "-x", "--"],
    ["export -n PWD OLDPWD; export PWD OLDPWD", "-x", "-x"],
  ] as const) {
    test(`${command} preserves export attributes after ${setup}`, async context => {
      const { shell } = await fixture();
      context.after(() => shell.dispose());
      const result = await shell.exec(`${before} ${setup}; ${command}; declare -p PWD OLDPWD`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `declare ${pwdFlag} PWD="${destination}"\ndeclare ${oldpwdFlag} OLDPWD="${previous}"\n`);
    });
  }
}

for (const [before, command, previous, destination] of [
  ["", "cd dir", "/work", "/work/dir"],
  ["", "cd -P link", "/work", "/work/dir/child"],
  ["", "pushd dir >/dev/null", "/work", "/work/dir"],
  ["pushd dir >/dev/null;", "popd >/dev/null", "/work/dir", "/work"],
] as const) {
  for (const [assignment, oldpwd] of [
    [":", previous], ["PWD=changed", "changed"], ["PWD=''", ""], ["unset PWD", "unset"],
  ] as const) {
    test(`${command} copies the previous PWD binding after ${assignment}`, async context => {
      const { shell } = await fixture();
      context.after(() => shell.dispose());
      const result = await shell.exec(`${before} ${assignment}; ${command}; printf '%s|%s|%s|' "$?" "$PWD" "\${OLDPWD-unset}"; pwd -P`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `0|${destination}|${oldpwd}|${destination}\n`);
    });
  }
}

test("cd preserves bytes from the previous PWD binding", async context => {
  const { shell } = await fixture();
  context.after(() => shell.dispose());
  const result = await shell.exec("PWD=$'\\377'; cd dir; printf '%s' \"$OLDPWD\"");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.stdoutBytes, Uint8Array.of(255));
});

for (const [setup, flag] of [["export OLDPWD", "-x"], ["export -n OLDPWD", "--"]]) {
  test(`cd with unset PWD preserves OLDPWD attributes after ${setup}`, async context => {
    const { shell } = await fixture();
    context.after(() => shell.dispose());
    const result = await shell.exec(`${setup}; unset PWD; cd dir; declare -p OLDPWD`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `declare ${flag} OLDPWD\n`);
  });
}

for (const [option, expected] of [["-P", "dir"], ["-L", "linkdir"]]) {
  test(`cd ${option} accepts the reported symlink operand`, async context => {
    const { shell } = await fixture();
    context.after(() => shell.dispose());
    const result = await shell.exec(`ln -s dir linkdir; cd ${option} linkdir; printf %s "\${PWD##*/}"`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  });
}

for (const [options, expected] of [
  ["", "/work/link"], ["-L", "/work/link"], ["-P", "/work/dir/child"],
  ["-L -P", "/work/dir/child"], ["-P -L", "/work/link"],
  ["-LP", "/work/dir/child"], ["-PL", "/work/link"],
] as const) {
  test(`cd ${options} publishes the selected path and preserves OLDPWD`, async context => {
    const { shell } = await fixture();
    context.after(() => shell.dispose());
    const result = await shell.exec(`cd ${options} link && printf '%s|%s|' "$PWD" "$OLDPWD"; pwd -P`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${expected}|/work|/work/dir/child\n`);
  });
}

for (const [script, expected] of [
  ["cd -L link/..", "/work"],
  ["cd -P link/..", "/work/dir"],
  ["cd link; cd -L ..", "/work"],
  ["cd link; cd -P ..", "/work/dir"],
  ["cd -L link/../-P", "/work/-P"],
  ["cd -P link; cd ../..", "/work"],
] as const) {
  test(`${script} resolves parents in the selected mode`, async context => {
    const { shell } = await fixture();
    context.after(() => shell.dispose());
    const result = await shell.exec(`${script}; printf '%s|%s|' "$?" "$PWD"; pwd -P`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `0|${expected}|${expected}\n`);
  });
}

for (const [script, expected] of [
  ["cd -P", "|/work/dir/child"],
  ["cd -L", "|/work/link"],
  ["cd -P -", "/search/link\n|/work/dir/child"],
  ["CDPATH=/search cd -P link", "/search/link\n|/work/dir/child"],
  ["CDPATH=/search/ cd -P link", "/search/link\n|/work/dir/child"],
  ["CDPATH=/search// cd -P link", "/search//link\n|/work/dir/child"],
  ["CDPATH=../search cd -P link", "../search/link\n|/work/dir/child"],
  ["CDPATH=. cd -P link", "./link\n|/work/dir/child"],
  ["OLDPWD=link cd -P -", "link\n|/work/dir/child"],
  // Preserve the existing Bash 5.3 CDPATH search for relative OLDPWD.
  ["CDPATH=/search OLDPWD=link cd -P -", "/search/link\n|/work/dir/child"],
  ["CDPATH=/search OLDPWD=link cd -L -", "/search/link\n|/search/link"],
  ["OLDPWD=/search//link/. cd -L -", "/search//link/.\n|/search/link"],
  ["CDPATH=/search cd -L link", "/search/link\n|/search/link"],
  ["cd -P -- -P", "|/work/-P"],
  ["cd -- -P", "|/work/-P"],
  ["pushd -- -P >/dev/null", "|/work/-P"],
] as const) {
  test(`${script} retains operand and search behavior`, async context => {
    const { shell } = await fixture();
    context.after(() => shell.dispose());
    const result = await shell.exec(`${script} && printf '|%s' "$PWD"`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  });
}

for (const [script, status, diagnostic] of [
  ["cd -P link dir", 1, "cd: too many arguments\n"],
  ["cd link -P", 1, "cd: too many arguments\n"],
  ["cd -Z link", 2, "cd: -Z: invalid option\n"],
  ["unset HOME; cd -P", 1, "cd: HOME not set\n"],
  ["unset OLDPWD; cd -L -", 1, "cd: OLDPWD not set\n"],
] as const) {
  test(`${script} fails before filesystem lookup or state changes`, async context => {
    const { fs, shell } = await fixture();
    context.after(() => shell.dispose());
    fs.stat = async () => { assert.fail("invalid cd arguments must not query the filesystem"); };
    const result = await shell.exec(`${script}; printf '%s|%s' "$?" "$PWD"`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, diagnostic);
    assert.equal(result.stdout, `${status}|/work`);
  });
}

test("cd -P keeps prefix bindings and subshell cwd isolated", async context => {
  const { shell } = await fixture();
  context.after(() => shell.dispose());
  const result = await shell.exec('PWD=temporary OLDPWD=temporary cd -P link; printf "%s|%s|" "$PWD" "$OLDPWD"; pwd; (cd -L /search/link; pwd); pwd');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "/work|/search/link|/work/dir/child\n/search/link\n/work/dir/child\n");
});

test("cd -P realpath failure leaves cwd, PWD and OLDPWD unchanged", async context => {
  const { fs, shell } = await fixture();
  context.after(() => shell.dispose());
  fs.realpath = async path => { throw new FsError("EACCES", { path }); };
  const result = await shell.exec('cd -P link; printf "%s|%s|%s|" "$?" "$PWD" "$OLDPWD"; pwd');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "shell: line 1: cd: link: Permission denied\n");
  assert.equal(result.stdout, "1|/work|/search/link|/work\n");
});

test("cd -P forwards cancellation through physical resolution", async context => {
  const { fs, shell } = await fixture();
  context.after(() => shell.dispose());
  const controller = new AbortController();
  fs.realpath = async (_path, options) => {
    assert.ok(options?.signal);
    controller.abort(false);
    options.signal.throwIfAborted();
    assert.fail("physical resolution must be cancelled");
  };
  await assert.rejects(shell.exec("cd -P link", { signal: controller.signal }), error => error === false);
});

for (const option of ["-L", "-P"]) {
  for (const [target, description] of [["missing/..", "No such file or directory"], ["file/..", "Not a directory"]]) {
    test(`cd ${option} ${target} validates components before parent traversal`, async context => {
      const { fs, shell } = await fixture();
      context.after(() => shell.dispose());
      await fs.writeFile("/work/file", new Uint8Array());
      const result = await shell.exec(`cd ${option} ${target}; printf '%s|%s|%s' "$?" "$PWD" "$OLDPWD"`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, `shell: line 1: cd: ${target}: ${description}\n`);
      assert.equal(result.stdout, "1|/work|/search/link");
    });
  }
}

test("cd -P applies the path bound to the resolved physical directory", async context => {
  const { fs, shell } = await fixture();
  context.after(() => shell.dispose());
  fs.realpath = async () => "/" + "x".repeat(65_536);
  const result = await shell.exec('cd -P link; printf "%s|%s|%s" "$?" "$PWD" "$OLDPWD"', { limits: { maxCdPathBytes: 65536 } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "shell: line 1: cd: path byte limit exceeded\n");
  assert.equal(result.stdout, "1|/work|/search/link");
});

test("cd option scanning yields to caller cancellation", async context => {
  const { fs, shell } = await fixture();
  context.after(() => shell.dispose());
  fs.stat = async () => { assert.fail("cancelled options must not reach directory lookup"); };
  const controller = new AbortController();
  const result = shell.exec(`cd -${"L".repeat(60_000)} link`, { signal: controller.signal });
  setImmediate(() => controller.abort(false));
  await assert.rejects(result, error => error === false);
});

for (const option of ["-L", "-P"]) {
  test(`cd ${option} checks search permission only on traversed directories`, async context => {
    const { fs, shell } = await fixture();
    context.after(() => shell.dispose());
    await fs.mkdir("/work/blocked", { mode: 0 });
    const result = await shell.exec(`cd ${option} blocked/..; printf '%s|%s' "$?" "$PWD"`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, option === "-L" ? "" : "shell: line 1: cd: blocked/..: Permission denied\n");
    assert.equal(result.stdout, `${option === "-L" ? 0 : 1}|/work`);
  });
}
