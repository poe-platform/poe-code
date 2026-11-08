import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";

const workerModule = createRequire(import.meta.url)("node:worker_threads");
const NativeWorker = workerModule.Worker;
const workers = [];
workerModule.Worker = class extends NativeWorker {
  constructor(filename, options) {
    const started = performance.now();
    super(filename, options);
    const record = { filename: String(filename), startupMs: null, exit: null, terminationCalls: 0, options, worker: this };
    workers.push(record);
    this.once("message", message => { assert.equal(message.ready, true); record.startupMs = performance.now() - started; });
    this.once("exit", code => { record.exit = code; });
    const original = this.terminate.bind(this);
    this.terminate = () => { record.terminationCalls++; return original(); };
  }
};
syncBuiltinESMExports();
const imported = performance.now();
const product = await import("virtual-bash");
const importMs = performance.now() - imported;
const { Shell, MemoryFileSystem, standardCommands, searchCommands } = product;
const regex = { requestTimeoutMs: 1000, startupTimeoutMs: 3000, maxWorkers: 2 };
const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands({ regex })).use(searchCommands({ regex }));
const input = "alpha\nneedle 123\n".repeat(16);
const definitions = {
  grep: { source: "grep -E 'needle [0-9]+'", expected: "needle 123\n".repeat(16) },
  rg: { source: "rg 'needle [0-9]+' -", expected: "needle 123\n".repeat(16) },
};
const records = [];
try {
  for (const [iteration, order] of [[0, ["grep", "rg"]], [1, ["rg", "grep"]], [2, ["grep", "rg"]]]) {
    for (const tool of order) {
      const before = workers.length;
      const started = performance.now();
      const result = await shell.exec(definitions[tool].source, { stdin: input });
      const elapsedMs = performance.now() - started;
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, definitions[tool].expected);
      assert.equal(result.stderr, "");
      for (const worker of workers.slice(before)) {
        assert.equal(worker.terminationCalls, 1);
        assert.notEqual(worker.exit, null);
        assert.equal(worker.worker.threadId, -1);
        for (const event of ["message", "error", "exit"]) assert.equal(worker.worker.listenerCount(event), 0);
      }
      records.push({ iteration, tool, elapsedMs, startupMs: workers.slice(before).map(worker => worker.startupMs), stdoutHash: createHash("sha256").update(result.stdout).digest("hex"), status: result.exitCode, stderr: result.stderr, inputHash: createHash("sha256").update(input).digest("hex"), workers: workers.length - before });
    }
  }
  const pipeline = await shell.exec("printf 'cat\\nno\\n' | grep -E 'c.t' | rg cat -");
  assert.equal(pipeline.exitCode, 0);
  assert.equal(pipeline.stdout, "cat\n");
  assert.equal(pipeline.stderr, "");
} finally {
  await shell.dispose();
  workerModule.Worker = NativeWorker;
  syncBuiltinESMExports();
}
console.log(JSON.stringify({ node: process.version, versions: process.versions, importMs, records, workers: workers.map(({ worker, ...record }) => ({ ...record, threadIdAfter: worker.threadId, listenersAfter: Object.fromEntries(["message", "error", "exit"].map(event => [event, worker.listenerCount(event)])) })), activeWorkers: workers.filter(record => record.worker.threadId !== -1).length }));
