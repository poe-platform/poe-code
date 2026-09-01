import assert from "node:assert/strict";
import test from "node:test";
import { Budget, declareHostOperation, makeFsModule, run } from "poe-code/safe-js";
import { createNodeCommand, createNodeCommands, nodeCommands, NODE_PROFILE } from "../../src/commands/node/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { safeJsCommands, type SafeJsRuntime } from "../../src/commands/safejs/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const runtime: SafeJsRuntime<Budget> = {
  run, makeFsModule, declareHostOperation,
  createBudget: options => new Budget(options),
};

function quote(source: string): string {
  return "'" + source.replaceAll("'", "'\\''") + "'";
}

test("node accepts the injected public SafeJS runtime through every registration API", async () => {
  for (const register of [
    (shell: Shell) => shell.use(nodeCommands({ runtime })),
    (shell: Shell) => shell.register(createNodeCommand({ runtime })),
    (shell: Shell) => shell.register(createNodeCommands({ runtime })[0]!),
  ]) {
    const shell = register(new Shell({ fs: new MemoryFileSystem() }));
    try {
      const result = await shell.exec(`node -e 'console.log("hello")'`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "hello\n");
    } finally { await shell.dispose(); }
  }
});

test("node print evaluates expressions, including undefined and inline option operands", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime }));
  try {
    for (const [source, expected] of [
      ["node -p '1 + 2'", "3\n"],
      ["node --print='JSON.stringify({ok: true})'", '{"ok":true}\n'],
      ["node -p 'undefined'", "undefined\n"],
      ["node -p '1 + 2 // comment'", "3\n"],
      ["node -e'console.log(4)'", "4\n"],
    ]) {
      const result = await shell.exec(source!);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
  } finally { await shell.dispose(); }
});

test("node runs virtual .js files with async fs, virtual process state and pipeline input", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/main.js", Buffer.from([
    'import fs from "fs";',
    'const input = await process.stdin.readText();',
    'await fs.writeFile("output.txt", input + process.argv[2]);',
    'console.log(process.cwd(), process.env.KEY, process.argv[1]);',
    'await process.stdout.write(await fs.readFile("output.txt", "utf8"));',
    'await process.stderr.write("notice");',
    'process.exitCode = 7;',
  ].join("\n")));
  const shell = new Shell({ fs, cwd: "/work", env: { KEY: "virtual" } })
    .use(standardCommands()).use(nodeCommands({ runtime }));
  try {
    const result = await shell.exec("printf 'input:' | node main.js 'literal arg'");
    assert.equal(result.exitCode, 7, result.stderr);
    assert.equal(result.stdout, "/work virtual /work/main.js\ninput:literal arg");
    assert.equal(result.stderr, "notice");
    assert.equal(Buffer.from(await fs.readFile("/work/output.txt")).toString(), "input:literal arg");
  } finally { await shell.dispose(); }
});

test("node consumes stdin source once and preserves Node argv shapes", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime }));
  try {
    for (const command of ["node", "node - extra"]) {
      const result = await shell.exec(command, { stdin: 'console.log(process.argv); console.log(await process.stdin.readText());' });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, JSON.stringify(["/virtual/bin/node", "-", ...(command === "node" ? [] : ["extra"])]) + "\n\n");
    }
    const result = await shell.exec("node -p 'process.argv' -- 'two words' --flag");
    assert.equal(result.stdout, '["/virtual/bin/node","two words","--flag"]\n');
  } finally { await shell.dispose(); }
});

test("node isolates process state and does not expose native require or process capabilities", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { KEY: "original" } }).use(nodeCommands({ runtime }));
  try {
    assert.equal((await shell.exec("node -e 'process.env.KEY = \"changed\"; process.exitCode = 3'")).exitCode, 3);
    const next = await shell.exec("node -p 'process.env.KEY'");
    assert.equal(next.stdout, "original\n");
    assert.equal(next.exitCode, 0);
    for (const source of ['require("node:child_process")', 'process.exit(0)', 'import fs from "child_process";']) {
      const result = await shell.exec("node -e " + quote(source));
      assert.equal(result.exitCode, 1, result.stderr);
      assert.ok(result.stderr.startsWith("node: "), result.stderr);
    }
  } finally { await shell.dispose(); }
});

test("node validates options without running the injected interpreter", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime: {
    ...runtime, run: async () => { assert.fail("invalid/help invocation must not run"); },
  } }));
  try {
    for (const command of ["node -e", "node -p", "node --inspect", "node --input-type=commonjs -e '1'"]) {
      assert.equal((await shell.exec(command)).exitCode, 2, command);
    }
    const help = await shell.exec("node --help");
    assert.equal(help.exitCode, 0);
    assert.ok(help.stdout.startsWith("Usage: node "));
  } finally { await shell.dispose(); }
});

test("node applies source, output and interpreter limits", async () => {
  for (const [limits, command] of [
    [{ maxSourceBytes: 2 }, "node -e 'console.log(123)'"],
    [{ maxOutputBytes: 2 }, "node -p '123'"],
    [{ maxSteps: 30 }, "node -e 'while (true) {}'"],
  ] as const) {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime, limits }));
    try { assert.equal((await shell.exec(command)).exitCode, 124, command); }
    finally { await shell.dispose(); }
  }
});

test("node forwards cancellation to its runtime", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel node");
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime: {
    ...runtime,
    async run(_source, options) {
      controller.abort(reason);
      assert.equal(options.signal.aborted, true);
      return { ok: true };
    },
  } }));
  try { await assert.rejects(shell.exec("node -e '1'", { signal: controller.signal }), error => error === reason); }
  finally { await shell.dispose(); }
});

test("node is opt-in, coexists with safejs and requires deliberate replacement", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  try {
    assert.equal((await shell.exec("node -p '1'")).exitCode, 127);
    shell.use(nodeCommands({ runtime })).use(safeJsCommands({ runtime }));
    await shell.exec("true");
    assert.throws(() => nodeCommands({ runtime }).setup({
      commands: shell.commands, use() { assert.fail("unexpected middleware"); },
      registerFileSystem() { assert.fail("unexpected filesystem"); },
    }));
    shell.use(nodeCommands({ runtime, replace: true }));
    assert.equal((await shell.exec("node -p '2'; safejs -p -e 'return 3;'")).stdout, "2\n3\n");
    assert.throws(() => nodeCommands({ runtime, provider: {} } as never));
    assert.throws(() => nodeCommands({ runtime, grants: {} } as never));
    assert.throws(() => nodeCommands({ runtime: undefined } as never));
  } finally { await shell.dispose(); }
});

test("node require exposes only the injected asynchronous VFS module", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(nodeCommands({ runtime }));
  try {
    for (const name of ["fs/promises", "node:fs/promises"]) {
      const source = `const fs = require(${JSON.stringify(name)}); await fs.writeFile("/result", "virtual"); console.log(await fs.readFile("/result", "utf8"));`;
      const result = await shell.exec("node -e " + quote(source));
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "virtual\n");
    }
    for (const name of ["fs", "node:fs", "./local.js", "__proto__"]) {
      assert.equal((await shell.exec("node -e " + quote(`require(${JSON.stringify(name)})`))).exitCode, 1);
    }
  } finally { await shell.dispose(); }
});

test("node keeps the existing explicit provider path and waits for retirement", async () => {
  const events: string[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ provider: {
    profile: NODE_PROFILE, identity: "inert-provider-contract",
    prepare(request) {
      events.push("prepare");
      assert.equal(request.source, "1");
      return {
        async start() {
          events.push("start");
          return { kind: "profileFailure", observation: { state: "unknown", fault: false, name: null, message: null, code: null } };
        },
        cancel() { events.push("cancel"); },
        async retire() { events.push("retire"); return { acquisition: "none", exitCode: null }; },
      };
    },
  } }));
  try {
    assert.equal((await shell.exec("node -e '1'")).exitCode, 2);
    assert.deepEqual(events, ["prepare", "start", "cancel", "retire"]);
  } finally { await shell.dispose(); }
});

test("node uses each supplied runtime and propagates syntax and runtime failures", async () => {
  for (const label of ["first", "second"]) {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime: {
      ...runtime,
      async run(source, options) {
        assert.ok(source.includes("console.log(1)"));
        assert.ok(options.bindings?.process);
        options.sink.log(label);
        return { ok: true };
      },
    } }));
    try { assert.equal((await shell.exec("node -e 'console.log(1)'")).stdout, label + "\n"); }
    finally { await shell.dispose(); }
  }
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime }));
  try {
    assert.equal((await shell.exec("node -e 'const ='")).exitCode, 2);
    assert.equal((await shell.exec("node -e 'throw new Error(\"guest failure\")'")).exitCode, 1);
    assert.equal((await shell.exec("node missing.js")).exitCode, 1);
    assert.equal((await shell.exec("node -e 'process.exitCode = 256'")).exitCode, 1);
  } finally { await shell.dispose(); }
});
