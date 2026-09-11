import assert from "node:assert/strict";
import test from "node:test";
import * as entry from "../../src/index.js";

test("the default preset and public factories expose enhanced getopt", () => {
  assert.equal(entry.createAgentCommands().filter(command => command.name === "getopt").length, 1);
  for (const name of ["createGetoptCommand", "createGetoptCommands", "getoptCommands"]) {
    assert.ok(name in entry, `Missing public export: ${name}`);
  }
});

test("a saved getopt script round-trips quoted and empty arguments through eval", async () => {
  const fs = entry.createMemoryFileSystem();
  await fs.mkdir("/work");
  const source = "parsed=$(getopt -o a:b:: --long alpha:,beta:: -- \"$@\") || exit \"$?\"\neval \"set -- $parsed\"\nprintf '%s\\n' \"$@\"\n";
  await fs.writeFile("/work/workflow.sh", new TextEncoder().encode(source));
  const shell = new entry.Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(entry.agentCommands());
  try {
    const result = await shell.exec("sh workflow.sh --alpha \"O'Reilly book\" -b -- tail ''");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 0, stdout: "--alpha\nO'Reilly book\n-b\n\n--\ntail\n\n", stderr: "",
    });
    assert.deepEqual(await fs.readFile("/work/workflow.sh"), new TextEncoder().encode(source));
  } finally { await shell.dispose(); }
});

test("getopt retains native partial normalization and target-error status", async () => {
  const shell = new entry.Shell({ fs: entry.createMemoryFileSystem(), env: { LC_ALL: "C" } }).use(entry.agentCommands());
  try {
    const result = await shell.exec("getopt -o a: --long alpha: -- --unknown -a value tail");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 1, stdout: " -a 'value' -- 'tail'\n", stderr: "getopt: unrecognized option '--unknown'\n",
    });
  } finally { await shell.dispose(); }
});

test("getopt enhanced-mode detection returns native status four", async () => {
  const shell = new entry.Shell({ fs: entry.createMemoryFileSystem(), env: { LC_ALL: "C" } }).use(entry.agentCommands());
  try {
    const result = await shell.exec("getopt -T");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 4, stdout: "", stderr: "" });
  } finally { await shell.dispose(); }
});

test("the aggregate forwards getopt limits without consulting nested replacement", async () => {
  const options = { limits: { maxArguments: 3 } };
  Object.defineProperty(options, "replace", { enumerable: true, get() { throw new Error("Unexpected nested replace"); } });
  const shell = new entry.Shell({ fs: entry.createMemoryFileSystem(), env: { LC_ALL: "C" } })
    .use(entry.agentCommands({ getopt: options }));
  try {
    const result = await shell.exec("getopt -o a -- -a");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 3, stdout: "", stderr: "getopt: argument count limit exceeded\n",
    });
  } finally { await shell.dispose(); }
});
