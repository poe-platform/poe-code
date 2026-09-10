import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test, { type Mock } from "node:test";
import {
  CommandRegistry, MemoryFileSystem, Shell, createBoundedRegexProvider, toByteSource,
  type BoundedRegexProvider, type RegexWorkerRequest,
} from "../../src/index.js";
import { agentCommands } from "../../src/index.js";
import { RegexExecutor } from "../../src/commands/regex-execution/portable.js";
import { defaults as regexDefaults } from "../../src/commands/regex-execution/protocol.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(ready => { resolve = ready; });
  return { promise, resolve };
}

for (const configuration of ["omitted", "empty"] as const) {
  test(`portable default ${configuration} options execute an in-memory script`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/workflow.sh", new TextEncoder().encode([
      "printf 'aa\\nbb\\n' > /input",
      "cat /input | grep -E 'a+' | egrep '^a' | fgrep aa | rg -F aa",
      "expr 2 + 3",
      "env sed 's/bb/cc/' /input | tail -n 1",
      "printf '\"1+1\"' | xargs jq -nc",
    ].join("\n")));
    const plugin = configuration === "omitted" ? agentCommands() : agentCommands({});
    const shell = new Shell({ fs }).use(plugin);
    try {
      const result = await shell.exec("sh /workflow.sh");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "aa\n5\ncc\n2\n");
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

test("invalid supplied providers do not silently select the default", () => {
  assert.throws(() => agentCommands({ regexExecutor: null! }), /provider/i);
});

test("default provider retains unsupported modes and bounded pattern admission", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  try {
    for (const command of ["grep -w a", "rg 'a+'"]) {
      const result = await shell.exec(command, { stdin: "aa\n" });
      assert.equal(result.exitCode, 2, command);
      assert.equal(result.stdout, "", command);
      assert.match(result.stderr, /bounded regex unsupported/u, command);
    }
    const expression = await shell.exec("expr aa : 'a*'");
    assert.equal(expression.exitCode, 0, expression.stderr);
    assert.equal(expression.stdout, "2\n");
    assert.equal(expression.stderr, "");
    const unsupportedExpression = await shell.exec("expr aa : '\\w'");
    assert.equal(unsupportedExpression.exitCode, 2);
    assert.equal(unsupportedExpression.stdout, "");
    assert.match(unsupportedExpression.stderr, /unsupported/u);
    const limited = await shell.exec(`grep -E '${"a".repeat(8193)}'`, { stdin: "aa\n" });
    assert.equal(limited.exitCode, 2);
    assert.equal(limited.stdout, "");
    assert.match(limited.stderr, /bounded regex limit:.*pattern/u);
    assert.equal((await shell.exec("grep -E a", { stdin: "aa\n" })).stdout, "aa\n");
  } finally { await shell.dispose(); }
});

test("defaults preserve collision preflight, replacement and custom execute fallback", async context => {
  const custom = { name: "custom", execute: () => ({ exitCode: 23 }) };
  const commands = new CommandRegistry([custom, { name: "jq", execute: () => ({ exitCode: 17 }) }]);
  const host = { commands, use() {}, registerFileSystem() {} };
  const before = commands.list();
  const originalCustom = commands.get("custom");
  const plugin = agentCommands();
  try {
    assert.throws(() => plugin.setup(host), /already registered: jq/u);
    assert.deepEqual(commands.list(), before);
  } finally { await plugin.dispose?.(); }
  const execute = context.mock.fn(() => ({ exitCode: 19 }));
  const replacement = agentCommands({ replace: true, execute });
  try {
    await replacement.setup(host);
    assert.equal(commands.get("custom"), originalCustom);
    assert.equal(commands.list().length, 106);
    const result = await commands.get("env")!.execute({
      command: "env", args: ["custom"], stdin: toByteSource(""),
      stdout: { async write() {} }, stderr: { async write() {} },
      fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
    });
    assert.equal(result.exitCode, 19);
    assert.equal(execute.mock.callCount(), 1);
    assert.equal(execute.mock.calls[0]!.arguments.length, 1);
  } finally { await replacement.dispose?.(); }
  assert.throws(() => replacement.setup(host), /disposed/u);
});

test("default providers are per preset while search policies remain per executor", async context => {
  const opened: RegexExecutor[] = [];
  const open = RegexExecutor.prototype.open;
  context.mock.method(RegexExecutor.prototype, "open", function (this: RegexExecutor, signal: AbortSignal) {
    opened.push(this);
    return open.call(this, signal);
  });
  const first = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands({
    regex: { maxWorkers: 1 }, search: { regex: { maxWorkers: 2 } },
  }));
  const second = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  try {
    for (const command of ["grep -E a", "egrep a", "fgrep a", "expr 1 + 1", "rg -F a"]) {
      assert.equal((await first.exec(command, { stdin: "a\n" })).exitCode, 0, command);
    }
    assert.equal((await second.exec("grep -E a", { stdin: "a\n" })).exitCode, 0);
    assert.equal(opened.length, 6);
    const [grep, egrep, fgrep, expr, search, other] = opened;
    assert.equal(grep, egrep);
    assert.equal(grep, fgrep);
    assert.equal(grep, expr);
    assert.notEqual(grep, search);
    assert.equal(grep!.provider, search!.provider);
    assert.notEqual(grep!.provider, other!.provider);
    assert.deepEqual(opened.map(executor => executor.options.maxWorkers), [1, 1, 1, 1, 2, 2]);
  } finally { await Promise.all([first.dispose(), second.dispose()]); }
});

test("default composition keeps structured and search limits local to their families", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands({
    structured: { limits: { maxInputBytes: 1 } }, search: { maxLineBytes: 1 },
  }));
  try {
    const structured = await shell.exec("jq .", { stdin: "[1]" });
    assert.notEqual(structured.exitCode, 0);
    assert.match(structured.stderr, /maxInputBytes/u);
    const search = await shell.exec("rg -F aa", { stdin: "aa\n" });
    assert.equal(search.exitCode, 2);
    assert.match(search.stderr, /limit/u);
    const grep = await shell.exec("grep -E a", { stdin: "aa\n" });
    assert.equal(grep.exitCode, 0, grep.stderr);
    assert.equal(grep.stdout, "aa\n");
  } finally { await shell.dispose(); }
});

test("caller provider handles every regex route without default substitution", async context => {
  const requests: RegexWorkerRequest[] = [];
  const policies: number[] = [];
  const terminations: Mock<() => Promise<void>>[] = [];
  const provider = {
    dispose: context.mock.fn(async () => {}),
    createWorker(policy: Readonly<RegexExecutor["options"]>) {
      policies.push(policy.maxWorkers);
      const events = new EventEmitter();
      const terminate = context.mock.fn(async () => { events.removeAllListeners(); });
      terminations.push(terminate);
      const worker = Object.assign(events, {
        postMessage(request: RegexWorkerRequest) {
          requests.push(request);
          queueMicrotask(() => events.emit("message", request.descriptor.kind === "expr-match"
            ? { id: request.id, operation: "expr-match", result: {
              offsetUnit: "byte", matched: true, hasCapture: false,
              overall: { start: 0, end: 2 }, capture: null, steps: 1,
            } }
            : { id: request.id, results: request.rows.map(() => new Float64Array([0, 2])) }));
        },
        terminate,
      });
      queueMicrotask(() => events.emit("message", { ready: true }));
      return worker;
    },
  } satisfies BoundedRegexProvider & { dispose(): Promise<void> };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands({
    regexExecutor: provider, regex: { maxWorkers: 1 }, search: { regex: { maxWorkers: 3 } },
  }));
  try {
    for (const command of ["grep -i aa", "egrep 'a+'", "fgrep aa", "expr aa : 'a*'", "rg 'a+'"]) {
      requests.length = 0;
      const result = await shell.exec(command, { stdin: "aa\n" });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, command.startsWith("expr") ? "2\n" : "aa\n");
      assert.equal(result.stderr, "");
      const kind = command.startsWith("expr") ? "expr-match" : command.startsWith("rg") ? "rg" : "grep";
      assert.ok(requests.length > 0, command);
      assert.ok(requests.every(request => request.descriptor.kind === kind), command);
    }
    assert.deepEqual(policies, [1, 1, 1, 1, 3]);
  } finally { await shell.dispose(); }
  assert.equal(terminations.length, 5);
  assert.ok(terminations.every(terminate => terminate.mock.callCount() === 1));
  assert.equal(provider.dispose.mock.callCount(), 0);
});

test("disposing one preset preserves a shared caller provider and caller endpoint", async context => {
  const backing = createBoundedRegexProvider({ maxWorkers: 2 });
  const provider = { ...backing, dispose: context.mock.fn(async () => {}) };
  const callerWorker = provider.createWorker(regexDefaults);
  const callerTerminate = context.mock.method(callerWorker, "terminate");
  const first = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands({ regexExecutor: provider }));
  const second = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands({ regexExecutor: provider }));
  try {
    assert.equal((await first.exec("egrep a", { stdin: "a\n" })).stdout, "a\n");
    await first.dispose();
    assert.equal((await second.exec("fgrep b", { stdin: "b\n" })).stdout, "b\n");
    await second.dispose();
    assert.equal(callerTerminate.mock.callCount(), 0);
    assert.equal(provider.dispose.mock.callCount(), 0);
  } finally { await Promise.all([first.dispose(), second.dispose(), callerWorker.terminate()]); }
});

for (const action of ["cancel", "dispose"] as const) {
  test(`${action} waits for owned endpoint retirement without disposing its provider`, { timeout: 3000 }, async context => {
    const submitted = deferred();
    const retiring = deferred();
    const release = deferred();
    const events = new EventEmitter();
    const terminate = context.mock.fn(async () => { retiring.resolve(); await release.promise; });
    const provider = {
      dispose: context.mock.fn(async () => {}),
      createWorker() {
        queueMicrotask(() => events.emit("message", { ready: true }));
        return Object.assign(events, { postMessage() { submitted.resolve(); }, terminate });
      },
    };
    const plugin = agentCommands({ regexExecutor: provider, search: { regex: { maxWorkers: 1 } } });
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(plugin);
    const controller = new AbortController();
    const reason = new Error("cancel preset request");
    let settled = false;
    const running = shell.exec(action === "cancel" ? "grep -E a" : "rg -F a", { stdin: "a\n", signal: controller.signal })
      .finally(() => { settled = true; });
    const outcome = action === "cancel" ? assert.rejects(running, error => error === reason) : running;
    let disposal: Promise<void> | undefined;
    try {
      await submitted.promise;
      if (action === "cancel") controller.abort(reason);
      else {
        disposal = Promise.resolve(plugin.dispose?.());
        assert.equal(plugin.dispose?.(), plugin.dispose?.());
      }
      await retiring.promise;
      assert.equal(settled, false);
      assert.equal(provider.dispose.mock.callCount(), 0);
      release.resolve();
      await outcome;
      await disposal;
      if (action === "dispose") {
        const result = await running;
        assert.equal(result.exitCode, 2);
        assert.match(result.stderr, /executor is disposed/u);
      }
      assert.equal(terminate.mock.callCount(), 1);
      assert.equal(events.eventNames().length, 0);
      assert.equal(controller.signal.aborted, action === "cancel");
    } finally {
      release.resolve();
      await running.catch(() => {});
      await shell.dispose();
    }
  });
}
