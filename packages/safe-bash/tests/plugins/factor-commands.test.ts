import assert from "node:assert/strict";
import test from "node:test";
import * as entry from "../../src/index.js";

for (const [command, stdin, stdout] of [
  ["factor --exponents 72", "", "72: 2^3 3^2\n"],
  ["factor 0 1 2 12 30 64 --exponents", "", "0:\n1:\n2: 2\n12: 2^2 3\n30: 2 3 5\n64: 2^6\n"],
  ["factor --exponents", "72\t97\n", "72: 2^3 3^2\n97: 97\n"],
  ["factor --exp 72", "", "72: 2^3 3^2\n"],
] as const) test(`factor exponent output: ${command}`, async () => {
  const shell = new entry.Shell({ fs: entry.createMemoryFileSystem() }).use(entry.agentCommands());
  try {
    const result = await shell.exec(command, { stdin });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 0, stdout, stderr: "",
    });
  } finally { await shell.dispose(); }
});

for (const [command, stderr] of [
  ["factor --exponents=yes 72", "factor: option '--exponents' doesn't allow an argument\nTry 'factor --help' for more information.\n"],
  ["factor -- --exponents", "factor: '--exponents' is not a valid positive integer\n"],
] as const) test(`factor exponent option validation: ${command}`, async () => {
  const shell = new entry.Shell({ fs: entry.createMemoryFileSystem() }).use(entry.agentCommands());
  try {
    const result = await shell.exec(command);
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 1, stdout: "", stderr,
    });
  } finally { await shell.dispose(); }
});

test("the default preset and public factories expose factor", () => {
  assert.equal(entry.createAgentCommands().filter(command => command.name === "factor").length, 1);
  for (const name of ["createFactorCommand", "createFactorCommands", "factorCommands"]) {
    assert.ok(name in entry, `Missing public export: ${name}`);
  }
});

test("a saved factor script preserves canonical argument and stdin output", async () => {
  const fs = entry.createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/numbers", new TextEncoder().encode("12\t+00018\n0 1\n"));
  await fs.writeFile("/work/workflow.sh", new TextEncoder().encode("factor 12 +00018 0 1 > arguments && factor < numbers > stream && cat arguments stream\n"));
  const shell = new entry.Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(entry.agentCommands());
  try {
    const expected = "12: 2 2 3\n18: 2 3 3\n0:\n1:\n";
    const result = await shell.exec("sh workflow.sh");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: expected + expected, stderr: "" });
    assert.deepEqual(await fs.readFile("/work/arguments"), new TextEncoder().encode(expected));
    assert.deepEqual(await fs.readFile("/work/stream"), new TextEncoder().encode(expected));
    assert.deepEqual(await fs.readFile("/work/numbers"), new TextEncoder().encode("12\t+00018\n0 1\n"));
  } finally { await shell.dispose(); }
});

test("factor diagnoses invalid operands while retaining later valid output", async () => {
  const shell = new entry.Shell({ fs: entry.createMemoryFileSystem(), env: { LC_ALL: "C" } }).use(entry.agentCommands());
  try {
    const result = await shell.exec("factor 12 invalid 18");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 1, stdout: "12: 2 2 3\n18: 2 3 3\n", stderr: "factor: 'invalid' is not a valid positive integer\n",
    });
  } finally { await shell.dispose(); }
});

test("the aggregate forwards the factor cap without consulting nested replacement", async () => {
  const options = { limits: { maxValue: 20 } };
  Object.defineProperty(options, "replace", { enumerable: true, get() { throw new Error("Unexpected nested replace"); } });
  const shell = new entry.Shell({ fs: entry.createMemoryFileSystem(), env: { LC_ALL: "C" } })
    .use(entry.agentCommands({ factor: options }));
  try {
    const result = await shell.exec("factor 18 21 20");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 1, stdout: "18: 2 3 3\n20: 2 2 5\n", stderr: "factor: '21' exceeds supported maximum 20\n",
    });
  } finally { await shell.dispose(); }
});
