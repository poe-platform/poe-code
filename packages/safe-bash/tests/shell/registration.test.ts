import assert from "node:assert/strict";
import test from "node:test";
import { Shell, createMemoryFileSystem, standardCommands, agentCommands, type CommandDefinition } from "../../src/index.js";
import { Shell as NodeShell } from "../../src/shell/node.js";

function replacement(name: string): CommandDefinition {
  return { name, async execute({ stdout }) {
    await stdout.write(new TextEncoder().encode(`custom ${name}\n`));
    return { exitCode: 42 };
  } };
}

test("both shell constructors require an explicit filesystem", () => {
  for (const Constructor of [Shell, NodeShell]) {
    assert.throws(() => new Constructor(), { name: "TypeError", message: "Shell requires an explicit filesystem" });
    assert.throws(() => new Constructor(undefined), { name: "TypeError", message: "Shell requires an explicit filesystem" });
  }
});

for (const plugin of [standardCommands, agentCommands]) {
  test(`${plugin.name} installation precedes chained replacement`, async t => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(plugin()).register(replacement("cat"), { replace: true });
    t.after(() => shell.dispose());
    const result = await shell.exec("cat");
    assert.equal(result.stdout, "custom cat\n");
    assert.equal(result.exitCode, 42);
  });
}

test("async plugins and registrations preserve call order", async t => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  t.after(() => shell.dispose());
  const definition = replacement("custom");
  shell.use({ name: "async", async setup(host) {
    await Promise.resolve();
    host.commands.register({ name: "custom", execute: () => ({ exitCode: 0 }) });
  } }).register(definition, { replace: true }).use({ name: "observe", setup(host) {
    assert.equal(host.commands.get("custom")?.execute, definition.execute);
  } });
  shell.register(replacement("custom"), { replace: true });
  assert.equal((await shell.exec("custom")).stdout, "custom custom\n");
});

test("registration remains synchronous when no plugin is pending", async t => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  t.after(() => shell.dispose());
  const definition = replacement("custom");
  shell.register(definition);
  assert.deepEqual(shell.commands.get("custom"), definition);
  assert.throws(() => shell.register(definition), /Command already registered: custom/);
});

test("queued registration still rejects duplicates without replace", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(standardCommands()).register(replacement("cat"));
  await assert.rejects(shell.exec("cat"), /Command already registered: cat/);
  await shell.dispose();
});

for (const name of ["true", "false", "pwd"]) {
  for (const mode of ["default", "unbounded", "middleware"] as const) {
    for (const source of [name, `${name} arg`, `command ${name}`, `"${name}"`, `x=1 ${name}`, `f() { ${name}; }; f`, `(${name})`, `set -o pipefail; ${name} | cat`, `for i in 1; do ${name}; done`, `${name} > /result; status=$?; cat /result; exit "$status"`]) {
      test(`custom registration dispatch (${mode}): ${source}`, async t => {
        const shell = new Shell({ fs: createMemoryFileSystem(), ...(mode === "unbounded" ? { limits: { maxExpansionFields: Infinity, maxExpansionBytes: Infinity, maxParseUnits: Infinity } } : {}) }).use(standardCommands());
        if (mode === "middleware") shell.use((_context, next) => next());
        t.after(() => shell.dispose());
        await shell.exec(":");
        shell.register(replacement(name), { replace: true });
        const result = await shell.exec(source);
        assert.equal(result.stdout, `custom ${name}\n`);
        assert.equal(result.exitCode, 42);
        assert.equal(result.stderr, "");
        const builtin = await shell.exec(`builtin ${name}`);
        assert.equal(builtin.stdout, name === "pwd" ? "/\n" : "");
        assert.equal(builtin.exitCode, name === "false" ? 1 : 0);
        assert.equal((await shell.exec(`echo "$(${name})"`)).stdout, `custom ${name}\n`);
        assert.equal((await shell.exec(`f() { ${name}; }; echo "$(f)"`)).stdout, `custom ${name}\n`);
      });
    }
  }
}
