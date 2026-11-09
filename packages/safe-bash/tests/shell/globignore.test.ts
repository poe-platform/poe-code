import assert from "node:assert/strict";
import test from "node:test";
import { standardCommands } from "../../src/index.js";
import { arraysExtension } from "../../src/shell/extensions/arrays/index.js";
import { setup } from "./helpers.js";

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
