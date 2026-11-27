import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { bashExecutable } from "../helpers/bash-oracle.js";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/core.js";

const env = { HOME: "/home/alice", OLDPWD: "/var/log", PATH: "/usr/bin:/bin", LC_ALL: "C" };
const cases = [
  ["default and alternate operands", "unset u; s=yes; printf '<%s>\\n' ${u-~/dir} ${u:-~/dir} ${s+~/dir} ${s:+~/dir} ${u:=~/dir}; printf '<%s>\\n' \"$u\""],
  ["assignment colons", "p=~/a:~/b:~+/c:~-/d; printf '<%s>\\n' \"$p\""],
  ["declarations", "export ex=~/a:~/b; declare dx=~/a:~/b; readonly rx=~/a:~/b; f() { local lx=~/a:~/b; printf '<%s>\\n' \"$lx\"; }; f; printf '<%s>\\n' \"$ex\" \"$dx\" \"$rx\""],
  ["ordinary assignment arguments", "HOME=/h; echo a=~ b=~/x c=x:~; env X=~/y printenv X; echo PREFIX=~/p"],
  ["assignment argument quoting", String.raw`printf '<%s>\n' a="~" a=\~ a=~"" a=~/"x" a=x\:~ a=x:~ a+=~/x a=~/x:~/y`],
  ["assignment argument syntax", String.raw`name=a; value='a=~'; printf '<%s>\n' a-b=~ 1a=~ =~/x "a"=~ a\=~ $name=~ $value a=~missing`],
  ["assignment argument splitting", String.raw`HOME='/home/a b:*'; value='one two'; printf '<%s>\n' a=$value a=~ a=~/x a=~/$value`],
  ["assignment arguments in pipelines and substitutions", String.raw`echo a=~ | cat; env X=~/y printenv X | cat; value=$(printf '%s' a=x:~); printf '<%s>\n' "$value"; echo a=~ >&1`],
  ["assignment arguments in command pipelines", String.raw`printf '%s\n' 'a=/home/alice' | grep a=~; for i in 1 2; do printf '%s\n' 'a=/home/alice' | grep a=~; done`],
  ["assignment arguments in loops", String.raw`for value in a=~ b=x:~; do printf '<%s>\n' "$value"; done; for i in 1 2; do echo a=~; done`],
  ["sh assignment arguments", String.raw`sh -c 'printf "<%s>\n" a=~ b=x:~; export a=~/x; printf "<%s>\n" "$a"'`],
  ["working directories", "printf '<%s>\\n' ~+ ~+/sub ~- ~-/sub; unset OLDPWD; printf '<%s>\\n' ~-"],
  ["quoted prefixes", "printf '<%s>\\n' ~\"\" ~\"foo\" ~'' ~\"/foo\" ~/\"foo\" \"~\"/foo ~\\+ ~missing"],
  ["mixed IFS across parts", "IFS=' :'; x='a '; y=': b'; printf '<%s>\\n' $x$y; x=' '; y=':b'; printf '<%s>\\n' \"a\"$x$y"],
  ["IFS boundaries and literal suffixes", "IFS=' :'; x='a '; y=' b '; z=': c'; printf '<%s>\\n' $x$y$z; printf '<%s>\\n' $x\"\"$z $x/end; x='a:'; y=':b'; printf '<%s>\\n' $x$y"],
  ["protected home expansion", "IFS=' :'; printf '<%s>\\n' ~ ${u:-~/dir}; p=~/a:~/b; printf '<%s>\\n' \"$p\""],
  ["quoted operands and assignment delimiters", "unset u; printf '<%s>\\n' \"${u:-~/dir}\" ${u:-~\"\"} ${u:-~/a:~/b}; p=~\"\":~/b; q=~/a\\:~/b; printf '<%s>\\n' \"$p\" \"$q\""],
  ["raw byte splitting", "IFS=' :'; x=$'a\\377 '; y=$': b\\376'; printf '<%s>\\n' $x$y"],
  ["empty quotes after IFS whitespace", "IFS=' :'; x='a '; z=':c'; printf '<%s>\\n' $x\"\" $x''$z $x${missing}"],
  ["raw bytes before empty quoted fields", "IFS=' :'; x=$'a\\377 '; z=$':c\\376'; printf '<%s>\\n' $x\"\"$z"],
] as const;

// Captured independently from Bash 5.2.37 and Darwin Bash 3.2.57, respectively.
const versionedFields = new Map<string, { modern: readonly string[]; legacy: readonly string[] }>([
  ["IFS boundaries and literal suffixes", {
    modern: ["a", "b", "c", "a", "", "c", "a", "/end", "a", "", "b"],
    legacy: ["a", "b", "c", "a", "c", "a", "/end", "a", "", "b"],
  }],
  ["protected home expansion", {
    modern: ["/home/a b:*", "/home/a b:*/dir", "/home/a b:*/a:/home/a b:*/b"],
    legacy: ["/home/a b:*", "/home/a", "b", "*/dir", "/home/a b:*/a:/home/a b:*/b"],
  }],
  ["empty quotes after IFS whitespace", { modern: ["a", "", "a", "", "c", "a"], legacy: ["a", "a", "c", "a"] }],
  ["raw bytes before empty quoted fields", { modern: ["a\xff", "", "c\xfe"], legacy: ["a\xff", "c\xfe"] }],
]);
const version = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", 'printf "%s" "$BASH_VERSION"'], { env, timeout: 2000 });
assert.ifError(version.error);
assert.equal(version.signal, null);
assert.equal(version.status, 0);
assert.equal(version.stderr.length, 0);
const bashVersion = version.stdout.toString();
const legacyOracle = bashVersion.startsWith("3.2.");
assert.ok(legacyOracle || Number(bashVersion.split(".")[0]) >= 5, `Unsupported Bash oracle dialect: ${bashVersion}`);

test("assignment arguments expand home on repeated file redirection", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("for HOME in /first /second; do echo a=~ > /result; cat /result | grep a=~; done");
  assert.equal(result.stdout, "a=/first\na=/second\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

for (const [name, script] of cases) {
  test(`tilde and IFS: ${name}`, async context => {
    const source = `OLDPWD=/var/log; ${script}`;
    // Isolate tilde quoting from oracle-specific same-line HOME reassignment.
    const caseEnv = name === 'protected home expansion' ? { ...env, HOME: '/home/a b:*' } : env;
    const expected = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", source], { cwd: "/", env: caseEnv, timeout: 2000 });
    assert.equal(expected.error, undefined);
    assert.equal(expected.signal, null);
    assert.equal(expected.status, 0);
    const contract = versionedFields.get(name);
    let expectedStdout = expected.stdout.toString("hex");
    if (contract) {
      const oracleFields = legacyOracle ? contract.legacy : contract.modern;
      assert.deepEqual(expected.stdout, Buffer.from(oracleFields.map(field => `<${field}>\n`).join(""), "latin1"), `Bash ${bashVersion}`);
      assert.equal(expected.stderr.length, 0);
      expectedStdout = Buffer.from(contract.modern.map(field => `<${field}>\n`).join(""), "latin1").toString("hex");
    }
    const shell = new Shell({ fs: createMemoryFileSystem(), env: caseEnv }).use(agentCommands());
    context.after(() => shell.dispose());
    const actual = await shell.exec(source);
    assert.deepEqual({ stdout: Buffer.from(actual.stdoutBytes).toString("hex"), stderr: Buffer.from(actual.stderrBytes).toString("hex"), status: actual.exitCode },
      { stdout: expectedStdout, stderr: expected.stderr.toString("hex"), status: expected.status });
  });
}
