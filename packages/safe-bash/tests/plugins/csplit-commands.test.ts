import assert from "node:assert/strict";
import test from "node:test";
import * as entry from "../../src/index.js";

test("the default preset and public factories expose csplit", () => {
  assert.equal(entry.createAgentCommands().filter(command => command.name === "csplit").length, 1);
  for (const name of ["createCsplitCommand", "createCsplitCommands", "csplitCommands"]) {
    assert.ok(name in entry, `Missing public export: ${name}`);
  }
});

test("a saved script splits a virtual file with native counts and contents", async () => {
  const fs = entry.createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/input", new TextEncoder().encode("alpha\nbeta\ngamma\n"));
  await fs.writeFile("/work/workflow.sh", new TextEncoder().encode("csplit input 2\n"));
  const shell = new entry.Shell({ fs, cwd: "/work" }).use(entry.agentCommands());
  try {
    const result = await shell.exec("sh workflow.sh");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "6\n11\n");
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile("/work/xx00"), new TextEncoder().encode("alpha\n"));
    assert.deepEqual(await fs.readFile("/work/xx01"), new TextEncoder().encode("beta\ngamma\n"));
  } finally { await shell.dispose(); }
});

test("elided empty output reuses the formatted suffix index", async () => {
  const fs = entry.createMemoryFileSystem();
  await fs.mkdir("/work");
  const input = new TextEncoder().encode("alpha\nbeta\ngamma\n");
  await fs.writeFile("/work/input", input);
  const shell = new entry.Shell({ fs, cwd: "/work" }).use(entry.agentCommands());
  try {
    const result = await shell.exec("csplit -z -f chunk -b '%03d.txt' input 1");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "17\n");
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile("/work/chunk000.txt"), input);
    await assert.rejects(fs.lstat("/work/chunk001.txt"), error => error instanceof entry.FsError && error.code === "ENOENT");
  } finally { await shell.dispose(); }
});

test("a malformed later pattern is rejected before creating output files", async () => {
  const fs = entry.createMemoryFileSystem();
  await fs.mkdir("/work");
  const input = new TextEncoder().encode("alpha\nbeta\ngamma\n");
  await fs.writeFile("/work/input", input);
  const shell = new entry.Shell({ fs, cwd: "/work" }).use(entry.agentCommands());
  try {
    const result = await shell.exec("csplit input 2 '/[/'");
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /csplit:/u);
    assert.deepEqual(await fs.readFile("/work/input"), input);
    assert.deepEqual((await fs.readdir("/work")).map(item => item.name), ["input"]);
  } finally { await shell.dispose(); }
});

test("the aggregate forwards csplit limits without accepting nested regex ownership", async () => {
  const fs = entry.createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/input", new TextEncoder().encode("alpha\nbeta\ngamma\n"));
  const options = { limits: { maxFiles: 1 } };
  for (const name of ["regex", "regexExecutor", "replace"]) {
    Object.defineProperty(options, name, { enumerable: true, get() { throw new Error(`Unexpected nested ${name}`); } });
  }
  const shell = new entry.Shell({ fs, cwd: "/work" }).use(entry.agentCommands({ csplit: options }));
  try {
    const result = await shell.exec("csplit input 2");
    assert.equal(result.exitCode, 1, result.stderr);
    assert.match(result.stderr, /limit/u);
    assert.deepEqual((await fs.readdir("/work")).map(item => item.name), ["input"]);
  } finally { await shell.dispose(); }
});

test("csplit and expr use the aggregate provider and retire their invocation workers", async () => {
  const fs = entry.createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/input", new TextEncoder().encode("alpha\nbeta\ngamma\n"));
  const backing = entry.createBoundedRegexProvider();
  const operations: string[] = [];
  let created = 0;
  let retired = 0;
  const regexExecutor: entry.BoundedRegexProvider = {
    createWorker(options) {
      created++;
      const worker = backing.createWorker(options);
      const postMessage = worker.postMessage.bind(worker);
      const terminate = worker.terminate.bind(worker);
      worker.postMessage = request => { operations.push(request.descriptor.kind); postMessage(request); };
      worker.terminate = async () => { retired++; return terminate(); };
      return worker;
    },
  };
  const shell = new entry.Shell({ fs, cwd: "/work" }).use(entry.agentCommands({ regexExecutor }));
  try {
    const result = await shell.exec("expr abc : 'a.*'; csplit input '/beta/'");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "3\n6\n11\n");
    assert.equal(result.stderr, "");
    assert.ok(operations.includes("expr-match"));
    assert.ok(operations.includes("bre-search"));
    assert.equal(created, 2);
    assert.equal(retired, 2);
  } finally { await shell.dispose(); }
  assert.equal(retired, 2);
});
