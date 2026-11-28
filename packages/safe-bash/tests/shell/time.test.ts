import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";

test("time honors TIMEFORMAT in redirected benchmark output", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), cwd: "/work" }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`TIMEFORMAT='%R real'; { time true; } 2>&1 | sed 's/[0-9]/N/g'; TIMEFORMAT='elapsed=%3lR'; { time true; } 2>&1 | sed 's/[0-9]/N/g'; TIMEFORMAT=; { time true; } 2>&1 | wc -c`);
  assert.equal(result.stdout, "N.NNN real\nelapsed=NmN.NNNs\n0\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("time formats precision, long CPU times, percent and utilization", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`TIMEFORMAT='%% %0U %1S %9U %lS %0lU %P'; time false`);
  assert.equal(result.stderr, "% 0 0.0 0.000 0m0.000s 0m0s 0.00\n");
  assert.equal(result.exitCode, 1);
});

test("portable time overrides an empty TIMEFORMAT", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("TIMEFORMAT=; time -p true");
  assert.match(result.stderr, /^real \d+\.\d{2}\nuser 0\.00\nsys 0\.00\n$/);
  assert.equal(result.exitCode, 0);
});

for (const format of ["%Q", "%1P", "%lP"]) {
  test(`time diagnoses invalid TIMEFORMAT ${format} without changing status`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`TIMEFORMAT='${format}'; time false`);
    assert.equal(result.stderr, `shell: TIMEFORMAT: \`${format.at(-1)}': invalid format character\n`);
    assert.equal(result.exitCode, 1);
  });
}

test("time reads the final TIMEFORMAT and preserves a trailing percent", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("TIMEFORMAT=before; time TIMEFORMAT='after%'");
  assert.equal(result.stderr, "after%\n");
  assert.equal(result.exitCode, 0);
});

test("function display retains time when evaluated again", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`f() { time -p echo hi; }; eval "$(declare -f f)"; f`);
  assert.equal(result.stdout, "hi\n");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr.split("real ").length - 1, 1);
});

test("time executes commands and sends portable timing through group redirection", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), cwd: "/work" }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`time echo hi; echo "st=$?"; { time -p true; } 2>&1 | cut -d' ' -f1`);
  assert.equal(result.stdout, "hi\nst=0\nreal\nuser\nsys\n");
  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /^\nreal\t\d+m\d+\.\d{3}s\nuser\t0m0\.000s\nsys\t0m0\.000s\n$/);
});

for (const source of [
  "time -p false",
  "time -p true | false",
  "set -o pipefail; time -p false | true",
  "time -p ! true",
  "! time -p true",
]) test(`time preserves pipeline status: ${source}`, async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(source);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^real \d+\.\d{2}\nuser 0\.00\nsys 0\.00\n$/);
});

test("time works in functions and loops and keeps command redirects separate", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`f() { time -p echo hi 2>/err; }; for i in 1 2; do f; done; cat /err`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hi\nhi\n");
  assert.equal(result.stderr.split("real ").length - 1, 2);
});

for (const source of [
  `echo "$(time -p echo hi)"`,
  `for i in 1 2; do time -p echo hi; done`,
  `for ((i=0; i<2; i++)); do time -p echo hi; done`,
  `f() { time -p echo hi; }; echo "$(f)"`,
  `time -p { echo hi; }`,
  `set -e; time -p false; echo unreachable`,
]) test(`time survives compound execution: ${source}`, async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(source);
  const failed = source.startsWith("set -e");
  const count = source.startsWith("for") ? 2 : 1;
  assert.equal(result.exitCode, failed ? 1 : 0);
  assert.equal(result.stdout, failed ? "" : "hi\n".repeat(count));
  assert.equal(result.stderr.split("real ").length - 1, count);
});
