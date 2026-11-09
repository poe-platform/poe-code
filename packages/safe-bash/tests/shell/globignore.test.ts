import assert from "node:assert/strict";
import test from "node:test";
import { standardCommands } from "../../src/index.js";
import { arraysExtension } from "../../src/shell/extensions/arrays/index.js";
import { setup } from "./helpers.js";

for (const [ignore, extglob, expected] of [
  ["a\\:b", false, ["a", "b", "keep"]],
  ["[a:b]", false, ["a:b", "keep"]],
  ["@(a:b|keep)", true, ["a", "b"]],
  ["a:b", false, ["a:b", "keep"]],
  [":a::b:", false, ["a:b", "keep"]],
  ["a\\:b:keep", false, ["a", "b"]],
  ["[a:b]:keep", false, ["a:b"]],
  ["[[:alpha:]:]:keep", false, ["a:b"]],
  ["@(a:b|keep):a", true, ["b"]],
  ["@(a:@(b|keep))", true, ["a", "b", "keep"]],
  ["@(a:b)", false, ["a", "a:b", "b", "keep"]],
  ["@(a:b", false, ["a", "a:b", "keep"]],
  ["@(a:b", true, ["a", "a:b", "b", "keep"]],
  ["[a:b", false, ["a", "a:b", "b", "keep"]],
  ["a\\\\:b", false, ["a", "a:b", "keep"]],
  ["\\@(a:b", true, ["a", "a:b", "keep"]],
  ["[a[b:c]:keep", false, ["a", "a:b", "b", "keep"]],
] as const) {
  test(`GLOBIGNORE=${ignore} preserves pattern boundaries (extglob=${extglob})`, async () => {
    const { fs, shell } = setup({ cwd: "/files", env: { LC_ALL: "C", HOME: "/" } });
    await fs.mkdir("/files");
    for (const name of ["a", "a:b", "b", "keep"]) await fs.writeFile(`/files/${name}`, new Uint8Array());
    try {
      const result = await shell.exec(`shopt -s dotglob; shopt ${extglob ? "-s" : "-u"} extglob; GLOBIGNORE='${ignore}'; args *`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.deepEqual(JSON.parse(result.stdout), expected);
    } finally { await shell.dispose(); }
  });
}

for (const recursive of [false, true]) {
  for (const arrays of [false, true]) {
    for (const [source, status, names] of [
      ["GLOBIGNORE=skip", 0, [".hidden", "visible"]],
      ["GLOBIGNORE=skip; shopt -u dotglob", 1, ["visible"]],
      ["GLOBIGNORE=skip; GLOBIGNORE=", 0, [".hidden", "visible"]],
      ["shopt -s dotglob; GLOBIGNORE=skip; unset GLOBIGNORE", 1, ["visible"]],
      ["GLOBIGNORE=skip; shopt -u dotglob; GLOBIGNORE=", 1, ["visible"]],
      ["GLOBIGNORE=skip; shopt -u dotglob; GLOBIGNORE=skip", 0, [".hidden", "visible"]],
      ["export GLOBIGNORE=skip", 0, [".hidden", "visible"]],
      ["printf -v GLOBIGNORE %s skip", 0, [".hidden", "visible"]],
      ["read GLOBIGNORE <<< skip", 0, [".hidden", "visible"]],
      ["GLOBIGNORE=$'\\xff'", 0, [".hidden", "visible"]],
      ["for n in 1 2; do GLOBIGNORE=skip; done", 0, [".hidden", "visible"]],
      ["GLOBIGNORE=skip; for n in 1 2; do unset GLOBIGNORE; done", 1, ["visible"]],
      ["shopt -s dotglob; unset GLOBIGNORE", 1, ["visible"]],
    ] as const) {
      test(`GLOBIGNORE option transitions: ${source} (recursive=${recursive}, arrays=${arrays})`, async () => {
        const { fs, shell } = setup({ extensions: arrays ? [arraysExtension()] : [] });
        shell.use(standardCommands());
        await fs.mkdir("/work");
        for (const name of [".hidden", "visible"]) await fs.writeFile(`/work/${name}`, new Uint8Array());
        try {
          const result = await shell.exec(`cd /work; ${recursive ? "shopt -s globstar; " : ""}${source}; shopt -q dotglob; echo option=$?; args ${recursive ? "**/*" : "*"}`);
          assert.equal(result.exitCode, 0);
          assert.equal(result.stderr, "");
          assert.equal(result.stdout, `option=${status}\n${JSON.stringify(names)}`);
        } finally { await shell.dispose(); }
      });
    }
  }
}

test("GLOBIGNORE retains prefixed log files and filters local names through standardCommands", async () => {
  const { shell } = setup({ env: { LC_ALL: "C", HOME: "/" }, extensions: [arraysExtension()] });
  shell.use(standardCommands());
  try {
    const result = await shell.exec("mkdir logs; touch logs/keep.txt logs/run.log; GLOBIGNORE='*.log'; printf '%s\\n' logs/*; (cd logs; printf 'local:%s\\n' *)");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "logs/keep.txt\nlogs/run.log\nlocal:keep.txt\n");
    const insensitive = await shell.exec("shopt -s nocaseglob; GLOBIGNORE='LOGS/*.LOG'; args logs/*");
    assert.equal(insensitive.exitCode, 0);
    assert.equal(insensitive.stderr, "");
    assert.deepEqual(JSON.parse(insensitive.stdout), ["logs/keep.txt"]);
  } finally { await shell.dispose(); }
});

for (const [ignore, pattern, expected] of [
  ["*.log", "logs/*", ["logs/keep.txt", "logs/run.log"]],
  ["logs/*.log", "logs/*", ["logs/keep.txt"]],
  ["*.log", "./logs/*", ["./logs/keep.txt", "./logs/run.log"]],
  ["*.log", "/logs/*", ["/logs/keep.txt", "/logs/run.log"]],
  ["*/run.log", "/logs/*", ["/logs/keep.txt", "/logs/run.log"]],
  ["/logs/*.log", "/logs/*", ["/logs/keep.txt"]],
  ["*.log:logs/keep.*", "logs/*", ["logs/run.log"]],
  ["logs?run.log", "logs/*", ["logs/keep.txt", "logs/run.log"]],
  ["logs[/]run.log", "logs/*", ["logs/keep.txt"]],
  ["logs*", "logs/*", ["logs/*"]],
  ["@(*.log|missing)", "logs/*", ["logs/keep.txt", "logs/run.log"]],
  ["logs/@(*.log|missing)", "logs/*", ["logs/keep.txt"]],
] as const) {
  test(`GLOBIGNORE=${ignore} filters the expanded paths from ${pattern}`, async () => {
    const { fs, shell } = setup({ env: { LC_ALL: "C", HOME: "/" } });
    await fs.mkdir("/logs");
    await fs.writeFile("/logs/keep.txt", new Uint8Array());
    await fs.writeFile("/logs/run.log", new Uint8Array());
    try {
      const result = await shell.exec(`shopt -s extglob; GLOBIGNORE='${ignore}'; args ${pattern}`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.deepEqual(JSON.parse(result.stdout), expected);
      const local = await shell.exec("GLOBIGNORE='*.log'; (cd logs; args *)");
      assert.equal(local.exitCode, 0);
      assert.equal(local.stderr, "");
      assert.deepEqual(JSON.parse(local.stdout), ["keep.txt"]);
      const unset = await shell.exec("unset GLOBIGNORE; args logs/*");
      assert.equal(unset.exitCode, 0);
      assert.equal(unset.stderr, "");
      assert.deepEqual(JSON.parse(unset.stdout), ["logs/keep.txt", "logs/run.log"]);
    } finally { await shell.dispose(); }
  });
}
