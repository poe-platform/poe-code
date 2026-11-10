import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, MemoryFileSystem, FsError, agentCommands } from "../../src/index.js";

// GNU Bash 5.3, LC_ALL=C.
const cdHelp = [
  "cd: cd [-L|[-P [-e]]] [-@] [dir]",
  "    Change the shell working directory.",
  "    ",
  "    Change the current directory to DIR.  The default DIR is the value of the",
  '    HOME shell variable. If DIR is "-", it is converted to $OLDPWD.',
  "    ",
  "    The variable CDPATH defines the search path for the directory containing",
  "    DIR.  Alternative directory names in CDPATH are separated by a colon (:).",
  "    A null directory name is the same as the current directory.  If DIR begins",
  "    with a slash (/), then CDPATH is not used.",
  "    ",
  "    If the directory is not found, and the shell option `cdable_vars' is set,",
  "    the word is assumed to be  a variable name.  If that variable has a value,",
  "    its value is used for DIR.",
  "    ",
  "    Options:",
  "      -L\tforce symbolic links to be followed: resolve symbolic",
  "    \t\tlinks in DIR after processing instances of `..'",
  "      -P\tuse the physical directory structure without following",
  "    \t\tsymbolic links: resolve symbolic links in DIR before",
  "    \t\tprocessing instances of `..'",
  "      -e\tif the -P option is supplied, and the current working",
  "    \t\tdirectory cannot be determined successfully, exit with",
  "    \t\ta non-zero status",
  "      -@\ton systems that support it, present a file with extended",
  "    \t\tattributes as a directory containing the file attributes",
  "    ",
  "    The default is to follow symbolic links, as if `-L' were specified.",
  "    `..' is processed by removing the immediately previous pathname component",
  "    back to a slash or the beginning of DIR.",
  "    ",
  "    Exit Status:",
  "    Returns 0 if the directory is changed, and if $PWD is set successfully when",
  "    -P is used; non-zero otherwise.",
  "",
].join("\n");

for (const command of ["cd --help", "builtin cd --help", "command cd --help", "cd -P --help", "cd -LP --help ignored extra"]) {
  test(`${command} prints Bash help without changing directory state`, async context => {
    const { fs, shell } = await fixture();
    context.after(() => shell.dispose());
    fs.stat = async () => { assert.fail("cd help must not query the filesystem"); };
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, new TextEncoder().encode(cdHelp));
    const state = await shell.exec('printf "%s|%s|" "$PWD" "$OLDPWD"; pwd');
    assert.equal(state.stdout, "/work|/search/link|/work\n");
    assert.equal(state.stderr, "");
  });
}

test("cd treats --help after -- as a directory name", async context => {
  const { fs, shell } = await fixture();
  context.after(() => shell.dispose());
  await fs.mkdir("/work/--help");
  const result = await shell.exec("cd -- --help; pwd");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "/work/--help\n");
  assert.equal(result.stderr, "");
});

test("cd does not recognize --help after a directory operand", async context => {
  const { shell } = await fixture();
  context.after(() => shell.dispose());
  const result = await shell.exec("cd dir --help");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "cd: too many arguments\n");
});

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

for (const option of ["", "-L", "-P"]) {
  for (const operand of ["''", '"$empty"', "-- ''"]) {
    test(`cd ${option} ${operand} rejects an explicit empty directory`, async context => {
      const { shell } = await fixture();
      context.after(() => shell.dispose());
      const result = await shell.exec(`OLDPWD=sentinel; empty=''; cd ${option} ${operand}; printf '%s|%s|%s|' "$?" "$PWD" "$OLDPWD"; pwd -P`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "1|/work|sentinel|/work\n");
      assert.equal(result.stderr, "shell: line 1: cd: null directory\n");
    });
  }
  for (const operand of [".", ""]) {
    test(`cd ${option} with ${operand || "no operand"} still succeeds`, async context => {
      const { shell } = await fixture();
      context.after(() => shell.dispose());
      const result = await shell.exec(`OLDPWD=sentinel; cd ${option} ${operand}; printf '%s|%s|%s' "$?" "$PWD" "$OLDPWD"`);
      const destination = operand === "." ? "/work" : option === "-P" ? "/work/dir/child" : "/work/link";
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, `0|${destination}|/work`);
      assert.equal(result.stderr, "");
    });
  }
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
  ["-e", "/work/link"], ["-Pe", "/work/dir/child"],
  ["-eP", "/work/dir/child"], ["-P -e", "/work/dir/child"],
  ["-PeL", "/work/link"], ["-LeP", "/work/dir/child"],
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
  ["cd -e dir", "/work/dir"],
  ["cd -Pe link/..", "/work/dir"],
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

for (const [variable, command] of [["HOME", "cd"], ["OLDPWD", "cd -"]]) {
  for (const [cdpath, destination, printed] of [
    ["missing:/search", "/search", "/search\n"],
    ["missing", "/work", variable === "OLDPWD" ? "\n" : ""],
    ["", "/work", variable === "OLDPWD" ? "\n" : ""],
  ]) {
    test(`${command} with empty ${variable} searches CDPATH=${cdpath} in Bash 5.3`, async context => {
      const { shell } = await fixture();
      context.after(() => shell.dispose());
      const result = await shell.exec(`${variable}=; CDPATH=${cdpath}; ${command}; printf '%s|%s|%s' "$?" "$PWD" "$OLDPWD"`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `${printed}0|${destination}|/work`);
    });
  }
}

for (const [script, status, diagnostic] of [
  ["cd -P link dir", 1, "cd: too many arguments\n"],
  ["cd link -P", 1, "cd: too many arguments\n"],
  ["cd -Z link", 2, "shell: line 1: cd: -Z: invalid option\ncd: usage: cd [-L|[-P [-e]]] [-@] [dir]\n"],
  ["cd -eZ link", 2, "shell: line 1: cd: -Z: invalid option\ncd: usage: cd [-L|[-P [-e]]] [-@] [dir]\n"],
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

for (const [prefix, oldpwd] of [["PWD=x OLDPWD=y", "x"], ["OLDPWD=x", "/work"], ["PWD=x", "x"]]) {
  test(`cd publishes directory bindings after ${prefix}`, async context => {
    const { shell } = await fixture();
    context.after(() => shell.dispose());
    const result = await shell.exec(`OLDPWD=sentinel; ${prefix} cd dir; printf '%s|%s|%s|' "$?" "$PWD" "$OLDPWD"; pwd -P`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `0|/work/dir|${oldpwd}|/work/dir\n`);
  });

  test(`failed cd restores directory bindings after ${prefix}`, async context => {
    const { shell } = await fixture();
    context.after(() => shell.dispose());
    const result = await shell.exec(`OLDPWD=sentinel; ${prefix} cd missing; printf '%s|%s|%s|' "$?" "$PWD" "$OLDPWD"; pwd -P`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "shell: line 1: cd: missing: No such file or directory\n");
    assert.equal(result.stdout, "1|/work|sentinel|/work\n");
  });
}

test("prefixed cd preserves unexported directory attributes and restores unrelated assignments", async context => {
  const { shell } = await fixture();
  context.after(() => shell.dispose());
  const result = await shell.exec('export -n PWD OLDPWD; OTHER=outer; PWD=x OLDPWD=y OTHER=inner cd dir; declare -p PWD OLDPWD; printf "%s" "$OTHER"');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, 'declare -- PWD="/work/dir"\ndeclare -- OLDPWD="x"\nouter');
});

for (const [source, prefix, flag] of [
  ["cd -x dir", "shell: line 1", "x"],
  [":\ncd -LxP dir", "shell: line 2", "x"],
  ["bash -c 'cd -Z dir' named-script", "named-script: line 1", "Z"],
  ["bash /work/invalid-cd.sh", "/work/invalid-cd.sh: line 2", "x"],
] as const) {
  test(`invalid cd flags include Bash 5.3 usage and context: ${source}`, async context => {
    const { fs, shell } = await fixture();
    context.after(() => shell.dispose());
    await fs.writeFile("/work/invalid-cd.sh", new TextEncoder().encode(":\ncd -x dir\n"));
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `${prefix}: cd: -${flag}: invalid option\ncd: usage: cd [-L|[-P [-e]]] [-@] [dir]\n`);
    const state = await shell.exec('printf "%s|%s|" "$PWD" "$OLDPWD"; pwd -P');
    assert.equal(state.stdout, "/work|/search/link|/work\n");
  });
}

test("cd -P publishes prefix bindings and keeps subshell cwd isolated", async context => {
  const { shell } = await fixture();
  context.after(() => shell.dispose());
  const result = await shell.exec('PWD=temporary OLDPWD=temporary cd -P link; printf "%s|%s|" "$PWD" "$OLDPWD"; pwd; (cd -L /search/link; pwd); pwd');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "/work/dir/child|temporary|/work/dir/child\n/search/link\n/work/dir/child\n");
});

for (const option of ["-P", "-Pe"]) {
  test(`cd ${option} realpath failure leaves cwd, PWD and OLDPWD unchanged`, async context => {
    const { fs, shell } = await fixture();
    context.after(() => shell.dispose());
    fs.realpath = async path => { throw new FsError("EACCES", { path }); };
    const result = await shell.exec(`cd ${option} link; printf "%s|%s|%s|" "$?" "$PWD" "$OLDPWD"; pwd`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "shell: line 1: cd: link: Permission denied\n");
    assert.equal(result.stdout, "1|/work|/search/link|/work\n");
  });
}

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
