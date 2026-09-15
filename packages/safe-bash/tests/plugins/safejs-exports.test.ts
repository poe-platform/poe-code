import assert from "node:assert/strict";
import test from "node:test";
import {
  agentCommands, createAgentCommands, createMemoryFileSystem, createSafeJsCommands,
  defaultSafeJsLimits, safeJsCommands, SafeJsCommandLimitError, Shell,
  type SafeJsBudgetOptions, type SafeJsCommandsOptions, type SafeJsRuntime,
} from "../../src/index.js";

test("root aggregate does not implicitly register or execute SafeJS", async () => {
  assert.equal(createAgentCommands().some(command => command.name === "safejs"), false);
  assert.equal(createAgentCommands().some(command => command.name === "node"), false);
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    assert.equal(shell.commands.has("safejs"), false);
    assert.equal(shell.commands.has("node"), false);
    const result = await shell.exec("safejs -e 'unexecuted source'");
    assert.equal(shell.commands.has("safejs"), false);
    assert.equal(result.exitCode, 127);
    assert.equal(result.stdout, "");
  } finally { await shell.dispose(); }
});

test("root optional JavaScript plugin requires explicit runtime configuration", () => {
  assert.throws(() => createSafeJsCommands({ runtime: undefined } as never), TypeError);
  assert.throws(() => safeJsCommands({ runtime: undefined } as never), TypeError);
});

test("root optional plugin delegates only to the explicit injected runtime", async () => {
  const calls: string[] = [];
  const runtime: SafeJsRuntime<SafeJsBudgetOptions> = {
    createBudget(options) { return options; },
    makeFsModule() { return {}; },
    declareHostOperation(operation) { return operation; },
    async run(source, options) {
      calls.push(source);
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.signal.aborted, false);
      assert.equal(options.budget.maxSteps, 1234);
      assert.deepEqual(options.modules.command?.args, ["argument"]);
      options.sink.log("injected result");
      return { ok: true };
    },
  };
  const options: SafeJsCommandsOptions<SafeJsBudgetOptions> = { runtime, limits: { maxSteps: 1234 } };
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands()).use(safeJsCommands(options));
  try {
    const result = await shell.exec("node -e 'opaque guest source' -- argument | cat");
    assert.equal(shell.commands.list().length, createAgentCommands().length + 1);
    assert.deepEqual(calls, ["opaque guest source\n;__safeBashSetExitCode(process.exitCode);"]);
    assert.equal(shell.commands.has("node"), true);
    assert.equal(shell.commands.has("safejs"), false);
    assert.equal(shell.commands.has("js"), false);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "injected result\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("explicit optional plugin replacement changes no aggregate command", async () => {
  const runtime: SafeJsRuntime<object> = {
    createBudget: options => options,
    makeFsModule: () => ({}),
    declareHostOperation: operation => operation,
    run: async () => ({ ok: true }),
  };
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands()).use(safeJsCommands({ runtime }));
  try {
    await shell.exec("");
    const before = shell.commands.list();
    await assert.rejects(async () => safeJsCommands({ runtime }).setup(shell), /already registered/);
    assert.deepEqual(shell.commands.list(), before);
    shell.use(safeJsCommands({ runtime, replace: true }));
    await shell.exec("");
    for (const definition of before.filter(command => command.name !== "node")) {
      assert.equal(shell.commands.get(definition.name), definition);
    }
  } finally { await shell.dispose(); }
});

test("root exports structural limit defaults and typed errors", () => {
  assert.ok(defaultSafeJsLimits.maxSourceBytes > 0);
  const error = new SafeJsCommandLimitError("maxSourceBytes");
  assert.equal(error.code, "SAFEJS_LIMIT");
  assert.equal(error.resource, "maxSourceBytes");
});
