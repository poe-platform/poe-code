import assert from "node:assert/strict";
import workerThreads from "node:worker_threads";
import { syncBuiltinESMExports } from "node:module";

const NativeWorker = workerThreads.Worker;
const workers = [];
let injectMessageerror = false;
class ObservedWorker extends NativeWorker {
  terminationCalls = 0;
  termination = undefined;
  exited = false;
  constructor(...args) {
    super(...args);
    workers.push(this);
    this.once("exit", () => { this.exited = true; });
  }
  postMessage(...args) {
    if (injectMessageerror) this.emit("messageerror", new Error("controlled packed receiver event"));
    else super.postMessage(...args);
  }
  terminate() { this.terminationCalls++; return this.termination = super.terminate(); }
}
workerThreads.Worker = ObservedWorker;
syncBuiltinESMExports();
const api = await import("virtual-bash");
const { RegexExecutor } = await import("./node_modules/virtual-bash/dist/commands/regex-execution/client.js");
const snapshot = () => workers.map(worker => ({ threadId: worker.threadId, exited: worker.exited, terminationCalls: worker.terminationCalls, listeners: Object.fromEntries(["message", "messageerror", "error", "exit"].map(event => [event, worker.listenerCount(event)])) }));
const evidence = { node: process.version, cases: [], f1: undefined };
try {
  for (const command of ["grep -E '^a'", "rg '^a'"]) {
    const shell = new api.Shell({ fs: new api.MemoryFileSystem() }).use(api.agentCommands());
    try {
      const result = await shell.exec(command, { stdin: "ab\nz\n" });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "ab\n");
      assert.equal(result.stderr, "");
      assert.equal(workers.filter(worker => !worker.exited).length, 0);
      evidence.cases.push({ command, result, workers: snapshot() });
    } finally { await shell.dispose(); }
  }
  injectMessageerror = true;
  const executor = new RegexExecutor({ requestTimeoutMs: 40 });
  const session = executor.open(new AbortController().signal);
  try {
    await assert.rejects(session.run({ kind: "grep", patterns: ["a"], fixed: false, extended: true, insensitive: false, whole: false, word: false }, [{ bytes: Uint8Array.of(97), all: true, terminated: true }]), { code: "PROTOCOL" });
    assert.equal(workers.filter(worker => !worker.exited).length, 0);
    evidence.cases.push({ command: "internal packed executor receive messageerror", code: "PROTOCOL", workers: snapshot() });
  } finally { await session.close(); await executor.dispose(); injectMessageerror = false; }

  const shell = new api.Shell({ fs: new api.MemoryFileSystem() }).use(api.agentCommands());
  const command = "grep -E '^a' | head -n 1";
  const result = await shell.exec(command, { stdin: "ab\n".repeat(200) });
  const atSettlement = snapshot();
  await shell.dispose();
  const afterDispose = snapshot();
  const failures = [];
  for (const [name, states] of [["exec settlement", atSettlement], ["after shell.dispose", afterDispose]]) {
    try { assert.equal(states.filter(worker => !worker.exited).length, 0, `${name}: zero active workers`); }
    catch (error) { failures.push({ name, error: error.stack }); }
  }
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "ab\n");
  assert.equal(result.stderr, "");
  let timer;
  try {
    await Promise.race([
      Promise.all(workers.map(worker => worker.termination ?? (worker.exited ? Promise.resolve() : new Promise(resolve => worker.once("exit", resolve))))),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("bounded exact-worker retirement observation expired")), 2000); }),
    ]);
  } finally { clearTimeout(timer); }
  evidence.f1 = { command, inputBytes: 600, result, atSettlement, afterDispose, failures, eventual: snapshot(), classification: failures.length ? "awaited-cleanup failure; eventual retirement is not an indefinite leak" : "not reproduced in this single scheduling observation; independent original failure remains" };
  for (const worker of workers) {
    assert.equal(worker.threadId, -1);
    assert.equal(worker.terminationCalls, 1);
    for (const event of ["message", "messageerror", "error", "exit"]) assert.equal(worker.listenerCount(event), 0);
  }
  evidence.final = snapshot();
  console.log(JSON.stringify(evidence));
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await Promise.all(workers.filter(worker => !worker.exited).map(worker => worker.termination ?? worker.terminate()));
  workerThreads.Worker = NativeWorker;
  syncBuiltinESMExports();
}
