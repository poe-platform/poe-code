import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";
import { setup } from "./helpers.js";

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
  assert.equal(queried.stdout, '["BC"]');
  const listed = await shell.exec("set -C; set +o");
  assert.ok(listed.stdout.includes("set -o noclobber\n"));
  assert.equal((await shell.exec("[[ -o noclobber ]]")).exitCode, 1);
});

for (const source of [
  `set -a; VALUE=hello; sh -c 'printf %s "$VALUE"'`,
  `BEFORE=hidden; set -a; VALUE=hello; set +a; AFTER=hidden; VALUE+=world; sh -c 'printf "<%s><%s><%s>" "$BEFORE" "$VALUE" "$AFTER"'`,
  `set -aeu; VALUE=hello; set +au; sh -c 'printf %s "$VALUE"'`,
  `set -o allexport; VALUE=hello; set +o allexport; AFTER=hidden; sh -c 'printf "<%s><%s>" "$VALUE" "$AFTER"'`,
  `set -a; (set +a; INNER=hidden); OUTER=hello; sh -c 'printf "<%s><%s>" "$INNER" "$OUTER"'`,
  `set -a; f() { local VALUE=local; sh -c 'printf %s "$VALUE"'; }; f; sh -c 'printf "<%s>" "$VALUE"'`,
  `set -a; : "\${VALUE:=default}"; for ITEM in one two; do :; done; let 'COUNT=3'; sh -c 'printf "<%s><%s><%s>" "$VALUE" "$ITEM" "$COUNT"'`,
  `set -a; case "$-" in *a*) printf on;; esac; set +a; case "$-" in *a*) printf bad;; *) printf off;; esac`,
  `set -a; [[ -o allexport ]]; printf '%s' "$?"; set +a; [[ -o allexport ]]; printf '%s' "$?"`,
  String.raw`set -a; sh -c 'CHILD=hidden; sh -c '\''printf "<%s>" "$CHILD"'\'''`,
  `set -a; VALUE=original; VALUE=temporary sh -c 'printf "<%s>" "$VALUE"'; sh -c 'printf "<%s>" "$VALUE"'`,
  `set -a; VALUE=hello; unset VALUE; set +a; VALUE=hidden; sh -c 'printf "<%s>" "$VALUE"'`,
]) {
  test(`automatic export matches Bash: ${source}`, async context => {
    const env = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };
    const expected = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], { cwd: "/", env, timeout: 2000 });
    assert.equal(expected.error, undefined);
    assert.equal(expected.signal, null);
    const shell = new Shell({ fs: createMemoryFileSystem(), env }).use(agentCommands());
    context.after(() => shell.dispose());
    const actual = await shell.exec(source);
    assert.deepEqual({ stdout: Buffer.from(actual.stdoutBytes).toString("hex"), stderr: Buffer.from(actual.stderrBytes).toString("hex"), exitCode: actual.exitCode },
      { stdout: expected.stdout.toString("hex"), stderr: expected.stderr.toString("hex"), exitCode: expected.status });
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
