import assert from "node:assert/strict";
import { Shell, agentCommands, createMemoryFileSystem, writeText } from "../../dist/index.js";

const scenario = process.argv[2];
assert.equal(scenario, "unsupported-before-chdir");
assert.equal(process.argv.length, 3);

for (const [command, expected, expectedCalls, missingStats] of [
  ["env -C /missing -S '--unsupported-option report'",
    [2, "", "env: unrecognized option '--unsupported-option'\n"], ["env"], 0],
  // Retain the historical input with its current supported-option behavior.
  ["env -C /missing -S '--argv0=unsafe report'",
    [1, "", "env: ENOENT: no such file or directory, stat '/missing'\n"], ["env"], 1],
  ["env -C /other -S '--argv0=chosen report'",
    [0, '{"argv0":"chosen","cwd":"/other","args":[]}\n', ""], ["env", "report"], 0],
]) {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.mkdir("/other");
  let missingStatCalls = 0;
  const stat = fs.stat.bind(fs);
  fs.stat = async (path, options) => {
    if (path === "/missing") missingStatCalls++;
    return stat(path, options);
  };
  const shell = new Shell({ fs, cwd: "/work", env: { PATH: "" } }).use(agentCommands());
  const calls = [];
  shell.use(async (context, next) => { calls.push(context.command); return next(); });
  shell.register({ name: "report", async execute(context) {
    await writeText(context.stdout, JSON.stringify({ argv0: context.argv0, cwd: context.cwd, args: context.args }) + "\n");
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec(command);
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], expected);
    assert.deepEqual(calls, expectedCalls);
    assert.equal(missingStatCalls, missingStats);
    assert.deepEqual(await fs.readdir("/work"), []);
    assert.deepEqual(await fs.readdir("/other"), []);
  } finally { await shell.dispose(); }
}
console.log(JSON.stringify({ scenario, passed: true }));
