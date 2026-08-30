import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const fixtures = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url)));

function expectedBytes(fixture) {
  return fixture.stdoutHex === undefined ? Buffer.from(fixture.stdout) : Buffer.from(fixture.stdoutHex, "hex");
}

function exact(result, fixture) {
  assert.equal(result.exitCode, fixture.exitCode);
  assert.deepEqual(Buffer.from(result.stdoutBytes), expectedBytes(fixture));
  if (fixture.diagnostic) {
    assert.match(Buffer.from(result.stderrBytes).toString("utf8"), /^expr: [^\r\n]+\n$/u);
  } else {
    assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(fixture.stderr));
  }
}

async function direct(root, definition, args, overrides = {}) {
  const stdout = [];
  const stderr = [];
  const cleanups = [];
  const context = {
    command: "expr", args, cwd: "/", env: { LC_ALL: "C" },
    fs: root.createMemoryFileSystem(), signal: new AbortController().signal,
    stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
    stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
    registerCleanup(cleanup) { cleanups.push(cleanup); },
    ...overrides,
  };
  Object.defineProperty(context, "stdin", { get() { assert.fail("expr accessed stdin"); } });
  try {
    const result = await definition.execute(context);
    return { ...result, stdoutBytes: Buffer.concat(stdout), stderrBytes: Buffer.concat(stderr) };
  } finally {
    await Promise.all(cleanups.flatMap(cleanup => [cleanup(), cleanup()]));
  }
}

async function usingShell(root, plugin, run, env = { LC_ALL: "C" }) {
  const shell = new root.Shell({ fs: root.createMemoryFileSystem(), env }).use(plugin);
  try { return await run(shell); } finally { await shell.dispose(); }
}

async function literal(shell, args) {
  shell.register({ name: "fixture-expr-invoke", execute: context => context.invoke("expr", args) });
  return shell.exec("fixture-expr-invoke");
}

export async function runPublicCases({ root, subpath, binding, observe }) {
  assert.equal(binding?.candidateQualifiedBeforeRun, true);
  assert.equal(binding?.du75AcceptedBeforeRun, true);
  assert.deepEqual([...binding.baselineNames].sort(), [...fixtures.baselineNames].sort());
  assert.equal(typeof observe?.begin, "function");
  assert.equal(typeof observe?.end, "function");
  const results = [];
  for (const fixture of fixtures.runtimeCases.slice(0, 24)) {
    const token = await observe.begin(fixture.id);
    let metrics;
    try {
      if (fixture.kind === "expression") {
        for (const variant of [fixture, ...(fixture.variants ?? [])]) {
          await usingShell(root, root.agentCommands({ expr: fixture.expr }), async shell => {
            exact(await literal(shell, variant.args), variant);
          }, variant.env ?? { LC_ALL: "C" });
        }
      } else if (fixture.kind === "api") {
        for (const entry of [root, subpath]) {
          for (const name of fixtures.factories) assert.equal(typeof entry[name], "function");
          assert.equal(entry.createExprCommand().name, "expr");
          assert.deepEqual(entry.createExprCommands().map(command => command.name), ["expr"]);
          assert.equal(entry.exprCommands().name, "expr-commands");
          await usingShell(root, entry.exprCommands(), async shell => {
            exact(await shell.exec("expr 7"), { exitCode: 0, stdout: "7\n", stderr: "" });
          });
        }
      } else if (fixture.kind === "inventory") {
        const expected = [...fixtures.baselineNames, "expr"].sort();
        assert.equal(new Set(expected).size, 76);
        assert.deepEqual(root.createAgentCommands().map(command => command.name).sort(), expected);
        await usingShell(root, root.agentCommands(), async shell => {
          await shell.exec("");
          assert.deepEqual(shell.commands.list().map(command => command.name).sort(), expected);
          for (const name of fixtures.excludedNames) assert.equal(shell.commands.has(name), false);
        });
      } else if (fixture.kind === "collision") {
        const existing = { name: "expr", execute: () => ({ exitCode: 42 }) };
        for (const entry of [root, subpath]) {
          for (const plugin of [entry.exprCommands(), root.agentCommands({ expr: { replace: true } })]) {
            const commands = new root.CommandRegistry([existing]);
            const before = commands.list();
            await assert.rejects(async () => plugin.setup({ commands }));
            assert.deepEqual(commands.list(), before);
          }
          const commands = new root.CommandRegistry([existing]);
          await entry.exprCommands({ replace: true }).setup({ commands });
          assert.notEqual(commands.get("expr").execute, existing.execute);
        }
        const commands = new root.CommandRegistry([existing]);
        await root.agentCommands({ replace: true, expr: { replace: false } }).setup({ commands });
        assert.notEqual(commands.get("expr").execute, existing.execute);
        assert.equal(commands.list().length, 76);
      } else if (fixture.kind === "no-input") {
        const expected = { exitCode: 0, stdout: "12\n", stderr: "" };
        exact(await direct(root, subpath.createExprCommand(), ["7", "+", "5"]), expected);
        await usingShell(root, root.agentCommands(), async shell => {
          exact(await literal(shell, ["7", "+", "5"]), expected);
        });
      } else if (fixture.kind === "pipeline") {
        const fs = root.createMemoryFileSystem();
        const shell = new root.Shell({ fs, env: fixture.env }).use(root.agentCommands());
        try {
          exact(await shell.exec(fixture.script), fixture);
          assert.deepEqual(Buffer.from(await fs.readFile(fixture.file)), Buffer.from(fixture.fileHex, "hex"));
        } finally { await shell.dispose(); }
      } else if (fixture.kind === "regex-policy") {
        const regex = { maxWorkers: 1, workerOldGenerationMb: 48, workerStackMb: 3, startupTimeoutMs: 3000 };
        for (const options of [{ expr: { regex: { maxWorkers: 0 } } }, { regex, expr: { regex: { maxWorkers: 0 } } }]) {
          await usingShell(root, root.agentCommands(options), async shell => {
            exact(await shell.exec("expr abc : a"), { exitCode: 0, stdout: "1\n", stderr: "" });
          });
          assert.ok(root.createAgentCommands(options).some(command => command.name === "expr"));
        }
        assert.throws(() => root.createAgentCommands({ regex: { maxWorkers: 0 }, expr: { regex } }));
        for (const entry of [root, subpath]) {
          assert.throws(() => entry.createExprCommand({ regex: { maxWorkers: 0 } }));
          const definition = entry.createExprCommand({ regex: { ...regex, workerOldGenerationMb: 64 }, limits: { maxNumericDigits: 1 } });
          exact(await direct(root, definition, ["abc", ":", "a"]), { exitCode: 0, stdout: "1\n", stderr: "" });
          await usingShell(root, root.agentCommands(), async shell => {
            await shell.exec("");
            shell.register(definition, { replace: true });
            exact(await shell.exec("expr 22 + 1"), { exitCode: 3, stdout: "", diagnostic: "expr-single-line" });
          });
        }
      } else if (fixture.kind === "sink-cleanup") {
        const sentinel = new Error("fixture-owned-sink-failure");
        let diagnosticWrites = 0;
        await assert.rejects(direct(root, root.createExprCommand(), ["7"], {
          stdout: { async write() { throw sentinel; } },
          stderr: { async write() { diagnosticWrites++; } },
        }), error => error === sentinel);
        assert.equal(diagnosticWrites, 0);
        await assert.rejects(direct(root, root.createExprCommand(), ["abc", ":", "a"], {
          registerCleanup() { throw sentinel; },
          stdout: { async write() { assert.fail("output after rejected registration"); } },
          stderr: { async write() { assert.fail("diagnostic after rejected registration"); } },
        }), error => error === sentinel);
      } else {
        assert.fail(`unimplemented frozen case ${fixture.id}`);
      }
    } finally { metrics = await observe.end(token); }
    for (const [field, expected] of [["workerCreations", fixture.expectedWorkerCreations], ["workerRequests", fixture.expectedWorkerRequests]]) {
      if (expected !== undefined) assert.equal(metrics[field], expected);
    }
    if (fixture.id === "R23") {
      assert.ok(metrics.workerOldGenerationMb.includes(48));
      assert.ok(metrics.workerOldGenerationMb.includes(64));
      assert.ok(metrics.workerStackMb.includes(3));
    }
    results.push({ id: fixture.id, assertions: "completed", qualification: "requires authenticated host observation and package protocol" });
  }
  return { results, unresolvedCases: ["R25", "R26"], fullAcceptance: false };
}
