import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";
import { setup } from "./helpers.js";

test("standard compatibility set options succeed", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), cwd: "/work" }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec('set -m; echo "m=$?"; set -o posix; echo "posix=$?"; set -v; echo "v=$?"; set +H; echo "H=$?"; set -o emacs; echo "emacs=$?"');
  assert.equal(result.stdout, "m=0\nposix=0\nv=0\nH=0\nemacs=0\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

for (const option of ["v", "m", "b", "k", "p", "t", "H", "E", "T",
  "o posix", "o monitor", "o verbose", "o vi", "o emacs", "o notify",
  "o keyword", "o privileged", "o onecmd", "o histexpand", "o history",
  "o ignoreeof", "o interactive-comments", "o nolog", "o errtrace", "o functrace"]) {
  test(`set accepts +/-${option} under errexit`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const result = await shell.exec(`set -e; set -${option}; set +${option}; say survived`);
    assert.equal(result.stdout, "survived\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

test("standard compatibility options succeed without aborting errexit scripts", async context => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  context.after(() => shell.dispose());
  const source = 'set -m; echo "m=$?"; set -o posix; echo "posix=$?"; set -v; echo "v=$?"; set +H; echo "H=$?"; set -o emacs; echo "emacs=$?"';
  for (const prefix of ["", "set -e; "]) {
    const result = await shell.exec(prefix + source);
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["m=0\nposix=0\nv=0\nH=0\nemacs=0\n", "", 0]);
  }
});

for (const [name, flag] of [
  ["verbose", "v"], ["monitor", "m"], ["notify", "b"], ["keyword", "k"],
  ["privileged", "p"], ["onecmd", "t"], ["histexpand", "H"],
  ["posix"], ["vi"], ["emacs"], ["history"], ["ignoreeof"], ["interactive-comments"], ["nolog"],
] as const) test(`compatibility option ${name} supports toggling, queries and local restoration`, async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  for (const option of [`o ${name}`, ...(flag ? [flag] : [])]) {
    const result = await shell.exec(`set -e; set -${option}; [[ -o ${name} ]]; test -o ${name}; shopt -oq ${name};
      case :$SHELLOPTS: in *:${name}:*) echo enabled;; esac
      f() { local -; set +${option}; }; f; [[ -o ${name} ]];
      (set +${option}); [[ -o ${name} ]]; set +o; set +${option};
      if [[ -o ${name} ]] || test -o ${name} || shopt -oq ${name}; then exit 7; fi
      echo disabled`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.ok(result.stdout.startsWith("enabled\n"));
    assert.ok(result.stdout.includes(`set -o ${name}\n`));
    assert.ok(result.stdout.endsWith("disabled\n"));
    if (flag) {
      const flags = await shell.exec(`set -${flag}; case $- in *${flag}*) echo enabled;; esac; set +${flag}; case $- in *${flag}*) echo leaked;; esac`);
      assert.deepEqual([flags.stdout, flags.stderr, flags.exitCode], ["enabled\n", "", 0]);
    }
  }
});

test("compatibility option clusters preserve positional arguments and reject unknown options", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec('set -evmbkptH -- one "two words"; set +vmbkptH; printf "<%s>" "$@"');
  assert.deepEqual([result.stdout, result.stderr, result.exitCode], ["<one><two words>", "", 0]);
  const invalid = await shell.exec("set -o made_up");
  assert.equal(invalid.exitCode, 2);
  assert.ok(invalid.stderr.includes("invalid option name"));
  assert.notEqual((await shell.exec("set -Z")).exitCode, 0);
});

test("compatibility options survive session snapshots", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const enabled = await shell.exec("set -mv -o posix", { onState() {} });
  const restored = await shell.exec("[[ -o monitor ]] && [[ -o verbose ]] && [[ -o posix ]]", { state: enabled.state });
  assert.deepEqual([restored.stdout, restored.stderr, restored.exitCode], ["", "", 0]);
});

for (const canonical of [true, false]) for (const option of ["-C", "-o noclobber", "-uC"]) {
  test(`noclobber ${option} preserves existing output with descriptor API ${canonical}`, async () => {
    const fs = createMemoryFileSystem();
    if (!canonical) Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, open: false } });
    await fs.writeFile("/output", new TextEncoder().encode("old"));
    const shell = new Shell({ fs }).use(agentCommands());
    const result = await shell.exec(`set ${option}; printf new > output; printf 'status=%s' "$?"; cat output`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "status=1old");
    assert.ok(result.stderr.includes("output: cannot overwrite existing file"));
    assert.equal(new TextDecoder().decode(await fs.readFile("/output")), "old");
  });
}

for (const canonical of [true, false]) test(`noclobber permits creation, append, override and disabling with descriptor API ${canonical}`, async () => {
  const fs = createMemoryFileSystem();
  if (!canonical) Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, open: false } });
  const shell = new Shell({ fs }).use(agentCommands());
  const result = await shell.exec("set -C; printf old > output; printf more >> output; cat output; printf forced >| output; cat output; set +C; printf short > output; cat output; set -o noclobber; set +o noclobber; printf final > output; cat output");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "oldmoreforcedshortfinal");
});

test("noclobber covers stderr and combined redirects and is inherited only by shell scopes", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/output", new TextEncoder().encode("old"));
  const shell = new Shell({ fs }).use(agentCommands());
  const result = await shell.exec('set -C; (printf new > output); printf "%s" "$?"; printf new 2> output; printf "%s" "$?"; printf new &> output; printf "%s" "$?"; f() { printf new > output; }; f; printf "%s" "$?"; bash -c \'printf child > output\'; cat output');
  assert.equal(result.stdout, "1111child");
  assert.equal(result.exitCode, 0);
});

test("noclobber is visible in option queries and does not persist across exec", async () => {
  const { shell } = setup();
  const queried = await shell.exec('set -C; args "$-"; [[ -o noclobber ]]');
  assert.equal(queried.exitCode, 0);
  assert.equal(queried.stdout, '["hBC"]');
  const listed = await shell.exec("set -C; set +o");
  assert.ok(listed.stdout.includes("set -o noclobber\n"));
  assert.equal((await shell.exec("[[ -o noclobber ]]")).exitCode, 1);
});

for (const [source, expectedStdout] of [
  [`set -a; VALUE=hello; sh -c 'printf %s "$VALUE"'`, "hello"],
  [`BEFORE=hidden; set -a; VALUE=hello; set +a; AFTER=hidden; VALUE+=world; sh -c 'printf "<%s><%s><%s>" "$BEFORE" "$VALUE" "$AFTER"'`, "<><helloworld><>"],
  [`set -aeu; VALUE=hello; set +au; sh -c 'printf %s "$VALUE"'`, "hello"],
  [`set -o allexport; VALUE=hello; set +o allexport; AFTER=hidden; sh -c 'printf "<%s><%s>" "$VALUE" "$AFTER"'`, "<hello><>"],
  [`set -a; (set +a; INNER=hidden); OUTER=hello; sh -c 'printf "<%s><%s>" "$INNER" "$OUTER"'`, "<><hello>"],
  [`set -a; f() { local VALUE=local; sh -c 'printf %s "$VALUE"'; }; f; sh -c 'printf "<%s>" "$VALUE"'`, "local<>"],
  [`set -a; : "\${VALUE:=default}"; for ITEM in one two; do :; done; let 'COUNT=3'; sh -c 'printf "<%s><%s><%s>" "$VALUE" "$ITEM" "$COUNT"'`, "<default><two><3>"],
  [`set -a; case "$-" in *a*) printf on;; esac; set +a; case "$-" in *a*) printf bad;; *) printf off;; esac`, "onoff"],
  [`set -a; [[ -o allexport ]]; printf '%s' "$?"; set +a; [[ -o allexport ]]; printf '%s' "$?"`, "01"],
  [String.raw`set -a; sh -c 'CHILD=hidden; sh -c '\''printf "<%s>" "$CHILD"'\'''`, "<>"],
  [`set -a; VALUE=original; VALUE=temporary sh -c 'printf "<%s>" "$VALUE"'; sh -c 'printf "<%s>" "$VALUE"'`, "<temporary><original>"],
  [`set -a; VALUE=hello; unset VALUE; set +a; VALUE=hidden; sh -c 'printf "<%s>" "$VALUE"'`, "<>"],
] as const) {
  test(`automatic export matches Bash: ${source}`, async context => {
    const env = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };
    const shell = new Shell({ fs: createMemoryFileSystem(), env }).use(agentCommands());
    context.after(() => shell.dispose());
    const actual = await shell.exec(source);
    assert.deepEqual({ stdout: actual.stdout, stderr: actual.stderr, exitCode: actual.exitCode },
      { stdout: expectedStdout, stderr: "", exitCode: 0 });
  });
}

test("set lists the automatic export option", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  assert.ok((await shell.exec("set -o")).stdout.startsWith("allexport\toff\n"));
  assert.ok((await shell.exec("set -a; set +o")).stdout.startsWith("set -o allexport\n"));
  assert.ok((await shell.exec("set -a; set +a; set +o")).stdout.startsWith("set +o allexport\n"));
});

test("native-backed errexit forms stop before subsequent commands and file effects", async () => {
  for (const source of [
    "set -e; false; say bad >after",
    "set -o errexit; false; say bad >after",
  ]) {
    const { shell, fs } = setup();
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stdoutBytes.length, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stderrBytes.length, 0);
    assert.deepEqual(await fs.readdir("/"), []);
  }
});

test("combined errexit and nounset options succeed without taking the failure branch", async () => {
  const { shell, fs } = setup();
  const result = await shell.exec("set -eu || say unsafe >after");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.deepEqual(await fs.readdir("/"), []);
  for (const source of ["set -eu; false; say unsafe >after", "set -eu; say \"$missing\"; say unsafe >after"]) {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    if (source.includes("$missing")) assert.match(result.stderr, /missing: unbound variable/u);
    else assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readdir("/"), []);
  }
});

test("supported set forms still execute normally", async () => {
  const { shell } = setup();
  assert.equal((await shell.exec('set -- a b; args "$@"')).stdout, '["a","b"]');
  assert.equal((await shell.exec("set -o pipefail; false | true")).exitCode, 1);
  assert.equal((await shell.exec("set +o pipefail; false | true")).exitCode, 0);
});

test("set with no arguments lists shell variables and functions and exits 0", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  const result = await shell.exec("x=hello; myfn() { echo hi; }; set");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^x=hello$/mu);
  assert.match(result.stdout, /^myfn \(\)/mu);
});

test("$_ tracks last argument of previous command, $LINENO tracks current line, $FUNCNAME tracks function stack, and let expands $var", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  const lastArg = await shell.exec('echo hello; echo "$_"; echo first second third; echo "$_"');
  assert.equal(lastArg.exitCode, 0);
  assert.equal(lastArg.stdout, "hello\nhello\nfirst second third\nthird\n");

  const lineno = await shell.exec("echo $LINENO\necho $LINENO\n");
  assert.equal(lineno.exitCode, 0);
  assert.equal(lineno.stdout, "1\n2\n");

  const funcname = await shell.exec('inner() { echo "$FUNCNAME:${FUNCNAME[0]}:${FUNCNAME[1]}:${#FUNCNAME[@]}:${FUNCNAME[*]}"; }; outer() { inner; }; outer');
  assert.equal(funcname.exitCode, 0);
  assert.equal(funcname.stdout, "inner:inner:outer:3:inner outer main\n");

  const letVar = await shell.exec('a=5; let "b = $a + 1"; let \'c = $b + $a\'; echo "$b:$c"');
  assert.equal(letVar.exitCode, 0);
  assert.equal(letVar.stdout, "6:11\n");
});
