import assert from "node:assert/strict";
import { syncBuiltinESMExports } from "node:module";
import threads from "node:worker_threads";
const NativeWorker = threads.Worker, records = [];
class ObservedWorker extends NativeWorker {
  constructor(filename, options) {
    super(filename, options);
    const record = { filename: filename.href, closed: false, errors: [] }; records.push(record);
    this.on("error", error => record.errors.push(error.message)); this.once("exit", code => { record.closed = true; record.code = code; });
  }
}
threads.Worker = ObservedWorker; syncBuiltinESMExports();
const { Shell, agentCommands, createMemoryFileSystem } = await import("virtual-bash");
const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
try {
  const result = await shell.exec("expr abc : a");
  assert.equal(result.exitCode, Number(process.argv[2]));
  assert.equal(records.length, 1); assert.match(records[0].filename, /\/dist\/commands\/regex-execution\/worker\.js$/u); assert.equal(records[0].closed, true);
  if (result.exitCode === 0) { assert.equal(result.stdout, "1\n"); assert.equal(result.stderr, ""); }
  else { assert.equal(result.stdout, ""); assert.match(result.stderr, /^expr: regex WORKER_ERROR: /u); assert.ok(records[0].errors.length > 0); }
  console.log(JSON.stringify({ workerLayout: records, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }));
} finally { await shell.dispose(); threads.Worker = NativeWorker; syncBuiltinESMExports(); }
