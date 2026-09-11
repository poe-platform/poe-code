import assert from "node:assert/strict";
import test from "node:test";
import * as entry from "../../src/index.js";

test("the default preset and public factories expose pr", () => {
  assert.equal(entry.createAgentCommands().filter(command => command.name === "pr").length, 1);
  for (const name of ["createPrCommand", "createPrCommands", "prCommands"]) {
    assert.ok(name in entry, `Missing public export: ${name}`);
  }
});

test("a saved script paginates a virtual file into balanced native columns", async () => {
  const fs = entry.createMemoryFileSystem();
  await fs.mkdir("/work");
  const input = new TextEncoder().encode("1\n2\n3\n4\n5\n6\n7\n");
  await fs.writeFile("/work/input", input);
  await fs.writeFile("/work/workflow.sh", new TextEncoder().encode("pr -3 -t -w20 input\n"));
  const shell = new entry.Shell({ fs, cwd: "/work" }).use(entry.agentCommands());
  try {
    const result = await shell.exec("sh workflow.sh");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "1      4      6\n2      5      7\n3\n");
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile("/work/input"), input);
    assert.deepEqual((await fs.readdir("/work")).map(item => item.name), ["input", "workflow.sh"]);
  } finally { await shell.dispose(); }
});

test("pr merges numbered virtual files without truncating separated fields", async () => {
  const fs = entry.createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/left", new TextEncoder().encode("1\n2\n3\n4\n"));
  await fs.writeFile("/work/right", new TextEncoder().encode("A\nB\nC\n"));
  const shell = new entry.Shell({ fs, cwd: "/work" }).use(entry.agentCommands());
  try {
    const result = await shell.exec("pr -m -t -n -s: left right");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "    1\t1:A\n    2\t2:B\n    3\t3:C\n    4\t4:\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("the aggregate forwards the pr clock without reading nested replacement", async () => {
  let samples = 0;
  const options = { clock: () => { samples++; return 946684800000; } };
  Object.defineProperty(options, "replace", { enumerable: true, get() { throw new Error("Unexpected nested replace"); } });
  const shell = new entry.Shell({ fs: entry.createMemoryFileSystem(), env: { LC_ALL: "C", TZ: "UTC" } })
    .use(entry.agentCommands({ pr: options }));
  try {
    const result = await shell.exec("pr -h TITLE -l12", { stdin: "1\n2\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "\n\n2000-01-01 00:00                      TITLE                       Page 1\n\n\n1\n2\n\n\n\n\n\n");
    assert.equal(result.stderr, "");
    assert.equal(samples, 1);
  } finally { await shell.dispose(); }
});

test("the aggregate forwards pr input limits", async () => {
  const shell = new entry.Shell({ fs: entry.createMemoryFileSystem() })
    .use(entry.agentCommands({ pr: { limits: { maxInputBytes: 2 } } }));
  try {
    const result = await shell.exec("pr -t", { stdin: "abc\n" });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.match(result.stderr, /limit/u);
  } finally { await shell.dispose(); }
});
