import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { standardCommands } from "../../src/index.js";
import { setup } from "./helpers.js";

const cases = [
  { flags: ["-O", "nullglob"], source: 'set -- missing*; echo "count=$#"', stdout: "count=0\n" },
  { flags: ["+O", "nullglob"], source: 'set -- missing*; echo "count=$#"', stdout: "count=1\n" },
  { flags: ["-O", "nullglob", "+O", "nullglob"], source: 'set -- missing*; echo "count=$#"', stdout: "count=1\n" },
  { flags: ["+O", "nullglob", "-O", "nullglob"], source: 'set -- missing*; echo "count=$#"', stdout: "count=0\n" },
  { flags: ["-O", "extglob"], source: 'case file.ts in *.@(js|ts)) echo matched;; esac', stdout: "matched\n" },
  { flags: ["-eO", "extglob"], source: 'case file.ts in *.@(js|ts)) echo matched;; esac', stdout: "matched\n" },
  { flags: ["-O", "extglob", "+O", "extglob"], source: 'shopt -p extglob; echo done', stdout: "shopt -u extglob\ndone\n" },
  { flags: ["-e", "-O", "nullglob", "-o", "pipefail"], source: 'set -- missing*; echo "count=$#"; false | true; echo unreachable', stdout: "count=0\n", status: 1 },
] as const;

for (const mode of ["command", "stdin", "file"] as const) {
  for (const entry of cases) test(`bash ${entry.flags.join(" ")} before ${mode} source`, async t => {
    const { shell, fs } = setup();
    shell.use(standardCommands());
    t.after(() => shell.dispose());
    const native = spawnSync("/bin/bash", ["--noprofile", "--norc", ...entry.flags, "-c", entry.source], {
      encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeout: 2000,
    });
    assert.equal(native.error, undefined);
    assert.equal(native.status, "status" in entry ? entry.status : 0, native.stderr);
    assert.equal(native.stdout, entry.stdout);
    assert.equal(native.stderr, "");
    if (mode === "file") await fs.writeFile("/script", new TextEncoder().encode(entry.source));
    const operand = mode === "command" ? `-c '${entry.source}'` : mode === "file" ? "/script" : "-s";
    const result = await shell.exec(`bash --noprofile --norc ${entry.flags.join(" ")} ${operand}`, {
      ...(mode === "stdin" ? { stdin: new TextEncoder().encode(entry.source) } : {}),
    });
    assert.equal(result.exitCode, native.status, result.stderr);
    assert.equal(result.stdout, native.stdout);
    assert.equal(result.stderr, native.stderr);
  });
}

test("startup shopt changes stay in the child and preserve positional arguments", async t => {
  const { shell, fs } = setup();
  shell.use(standardCommands());
  t.after(() => shell.dispose());
  const source = 'echo "$0:$1:$2"; shopt -p nullglob; echo done';
  await fs.writeFile("/script", new TextEncoder().encode(source));
  const result = await shell.exec(`shopt -s nullglob
bash +O nullglob -c '${source}' child first second
bash +O nullglob /script first second
shopt -p nullglob`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "child:first:second\nshopt -u nullglob\ndone\n/script:first:second\nshopt -u nullglob\ndone\nshopt -s nullglob\n");
});

for (const flag of ["-O", "+O"]) test(`${flag} rejects unknown shopt names before consuming source`, async t => {
  const { shell } = setup();
  t.after(() => shell.dispose());
  let reads = 0;
  const stdin = { async *[Symbol.asyncIterator]() { reads++; yield new TextEncoder().encode("echo unreachable"); } };
  for (const operand of ["-s", "-c 'echo unreachable'", "/missing-script"]) {
    const result = await shell.exec(`bash ${flag} not_a_shopt_option ${operand}`, { stdin });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("not_a_shopt_option"), result.stderr);
  }
  assert.equal(reads, 0);
});

for (const flag of ["-O", "+O"]) test(`${flag} without a name lists supported shopt settings`, async t => {
  const { shell } = setup();
  t.after(() => shell.dispose());
  const result = await shell.exec(`bash -O nullglob ${flag} -c 'exit 7'`);
  assert.equal(result.exitCode, 7, result.stderr);
  assert.equal(result.stderr, "");
  assert.ok(result.stdout.includes(flag === "+O" ? "shopt -s nullglob\n" : "nullglob            \ton\n"), result.stdout);
});
