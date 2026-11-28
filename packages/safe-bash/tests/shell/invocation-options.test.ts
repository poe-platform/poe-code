import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { bashExecutable, modernBashSkip } from "../helpers/bash-oracle.js";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";

const names = ["allexport", "braceexpand", "errexit", "noclobber", "noexec", "noglob", "nounset", "pipefail"];
test("xtrace includes conditions, arithmetic, for iterations and case selection", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("set -x; x=1; [[ $x == 1 ]]; (( x++ )); for i in a b; do :; done; case $x in 2) :;; esac");
  assert.equal(result.stdout, "");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "+ x=1\n+ [[ 1 == 1 ]]\n+ ((  x++  ))\n+ for i in a b\n+ :\n+ for i in a b\n+ :\n+ case $x in\n+ :\n");
});

for (const source of [
  "set -ex; echo hello; echo world",
  "set -euxo pipefail; echo hello; echo world",
  "set -o xtrace; echo hello; echo world",
  "bash -x -c 'echo hello; echo world'",
  "bash -o xtrace -c 'echo hello; echo world'",
  "bash -euxo pipefail -c 'echo hello; echo world'",
  "bash -x /trace.sh",
]) test(`xtrace: ${source}`, async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/trace.sh", new TextEncoder().encode("echo hello; echo world"));
  const shell = new Shell({ fs }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(source);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello\nworld\n");
  assert.equal(result.stderr, "+ echo hello\n+ echo world\n");
});

test("xtrace expands arguments, traces assignments and redirects, and can be disabled", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`set -x; VALUE='hello world'; echo "$VALUE" 2>/trace; set +o xtrace; echo quiet; cat /trace`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello world\nquiet\n+ echo 'hello world'\n");
  assert.equal(result.stderr, "+ VALUE='hello world'\n+ set +o xtrace\n");
});

test("xtrace uses PS4 and restores local options", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`PS4='trace: '; f() { local -; set -x; echo inside; }; f; echo outside; set -x; echo "$-"; set +x; [[ -o xtrace ]]`);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "inside\noutside\nhxB\n");
  assert.equal(result.stderr, "trace: echo inside\ntrace: echo hxB\ntrace: set +x\n");
});

for (const source of [
  `set -x; x=1; [[ $x == 1 ]]; (( x++ )); for i in a b; do :; done; case $x in 2) :;; esac`,
  `set -x; [[ -n foo && ! -z bar ]]; [[ '' && $(echo unreachable) ]]; [[ a == b || a == a ]]`,
  `set -x; x='a b'; for i in "$x" c; do [[ $i == "$x" ]]; done; case "$x" in *) :;; esac`,
  `PS4='trace: '; set -x; x=1; (( $x + 2 )); (( x++ )); [[ $x -eq 2 ]]; for i; do :; done`,
  `set -x; [[ abc =~ a.c ]]; [[ abc =~ "abc" ]]`,
  `set -x; [[ ! abc =~ x ]]; [[ $(echo once) == once ]]; (( $(echo 1) )); for i in; do :; done; case $(echo x) in y) :;; esac`,
  `set -- a b; set -x; for i; do :; done; set +x; [[ a == a ]]; (( 1 )); for i in a; do :; done; case a in a) :;; esac`,
  `set -x; echo "$(echo inner)"; set +x`,
  `PS4='line $LINENO: '; set -x; echo hello; set +x`,
  `set -x; f() { echo "$1"; }; f 'hello world'; (echo subshell); set +x`,
  `set -x; echo '' 'a"b' "a'b" 'a$b'; set +x`,
  `set -ex; false; echo unreachable`,
  `set -x; shopt -oq xtrace; echo "\${SHELLOPTS##*:}"; set +x`,
  `set -x; PS4='> '; echo hello; set +x`,
  `set -x; echo hello 2>&-; echo after`,
  `unset PS4; set -x; echo hello; (echo subshell)`,
]) test(`xtrace matches Bash: ${source}`, { skip: modernBashSkip }, async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const expected = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
  assert.ifError(expected.error);
  const actual = await shell.exec(source);
  assert.deepEqual({ stdout: actual.stdout, stderr: actual.stderr, exitCode: actual.exitCode }, { stdout: expected.stdout, stderr: expected.stderr, exitCode: expected.status });
});

test("PS4 expansion failures do not prevent command execution", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`PS4='\${MISSING} '; set -ux; echo hi; echo bye`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hi\nbye\n");
  assert.equal(result.stderr, "shell: line 1: MISSING: unbound variable\n${MISSING} echo hi\nshell: line 1: MISSING: unbound variable\n${MISSING} echo bye\n");
});
for (const command of ["bash", "sh"]) for (const [name, flag] of [["allexport", "a"], ["noglob", "f"], ["noclobber", "C"], ["errexit", "e"], ["nounset", "u"], ["braceexpand", "B"], ["pipefail", undefined]] as const) {
  for (const mode of ["string", "stdin", "file"]) test(`${command} ${name} via ${mode}`, async context => {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs }).use(agentCommands());
    context.after(() => shell.dispose());
    const source = `[[ -o ${name} ]]; printf '%s' "$?"`;
    await fs.writeFile("/script", new TextEncoder().encode(source));
    const invoke = (options: string) => mode === "string" ? `${command} ${options} -c '${source}'` : mode === "file" ? `${command} ${options} /script` : `printf '%s' '${source}' | ${command} ${options} -s`;
    for (const options of [`-o ${name}`, ...(flag ? [`-${flag}`] : [])]) {
      assert.equal((await shell.exec(invoke(options))).stdout, "0");
      const disabled = await shell.exec(invoke(`${options} +o ${name}`));
      assert.equal(disabled.stdout, "1");
      assert.equal(disabled.stderr, "");
      if (flag) assert.equal((await shell.exec(invoke(`${options} +${flag}`))).stdout, "1");
    }
  });
}
test("shopt exposes the complete set namespace", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const listed = await shell.exec("shopt -op");
  for (const name of names) assert.ok(listed.stdout.includes(`o ${name}\n`));
  assert.equal(listed.stderr, "");
  const changed = await shell.exec("shopt -os allexport; shopt -oq allexport; printf '%s' \"$?\"; shopt -ou allexport; shopt -oq allexport; printf '%s' \"$?\"; shopt -op noexec");
  assert.equal(changed.stdout, "01set +o noexec\n");
  assert.equal(changed.stderr, "");
});
test("invocation options affect execution", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  assert.equal((await shell.exec("bash -o errexit -c 'false; echo bad'")).exitCode, 1);
  assert.equal((await shell.exec("bash -o pipefail -c 'false | true'")).exitCode, 1);
  assert.equal((await shell.exec(`bash -a -c 'VALUE=hello; sh -c '\\''printf %s "$VALUE"'\\'''`)).stdout, "hello");
  assert.equal((await shell.exec("bash -o noexec -c 'echo bad'")).stdout, "");
});
