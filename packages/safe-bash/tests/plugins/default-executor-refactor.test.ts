import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { build } from "esbuild";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { CommandRegistry, type CommandDefinition, type VirtualShellPlugin } from "../../src/contracts/index.js";
import { agentCommands, createAgentCommands } from "../../src/plugins/index.js";
import { grepCommands } from "../../src/commands/grep.js";
import { createStandardCommands, standardCommands } from "../../src/commands/index.js";
import { rgCommand } from "../../src/commands/search/rg.js";
import { createSearchCommands, searchCommands } from "../../src/commands/search/index.js";
import { createExprCommand, createExprCommands, exprCommands } from "../../src/commands/expr/index.js";
import { createGrepAliasCommands, egrepCommand, fgrepCommand, grepAliasCommands } from "../../src/commands/grep-aliases/index.js";
import { createBoundedRegexProvider } from "../../src/commands/regex-execution/bounded-provider.js";
import { RegexExecutor } from "../../src/commands/regex-execution/portable.js";
import { defaults } from "../../src/commands/regex-execution/protocol.js";
import type { BoundedRegexProvider, RegexWorkerRequest } from "../../src/commands/regex-execution/provider.js";

const expectedNames = [
  "true", "false", "echo", "pwd", "basename", "dirname", "printf", "mkdir", "touch",
  "cp", "mv", "rm", "rmdir", "ln", "readlink", "realpath", "ls", "cat", "head", "tail",
  "wc", "tee", "tr", "sort", "uniq", "cut", "grep", "test", "[", "env", "xargs", "find", "cmp", "fmt", "shuf", "numfmt",
  "sed", "awk", "jq", "rg", "base64", "base32", "xxd", "od", "sha512sum", "sha384sum", "sha256sum", "sha224sum", "sha1sum",
  "md5sum", "cksum", "gzip", "gunzip", "zcat", "bzip2", "bunzip2", "bzcat", "xz", "unxz", "xzcat", "zstd", "unzstd", "zstdcat", "diff", "patch", "chmod", "stat", "mktemp", "truncate", "tar", "zip", "unzip",
  "paste", "comm", "join", "tac", "expand", "fold", "strings", "seq", "nl", "rev", "unexpand", "split",
  "date", "sleep", "printenv", "tree", "file", "egrep", "fgrep", "column", "html-to-markdown", "du", "expr", "which", "timeout", "apply_patch", "xq", "xmllint", "csplit", "pr", "tsort", "factor", "getopt",
].sort();

type Installation = readonly CommandDefinition[] | VirtualShellPlugin;
type Factory = (options: { readonly regexExecutor?: BoundedRegexProvider }) => Installation;

function install(commands: Installation): Shell {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  if ("setup" in commands) shell.use(commands);
  else for (const command of commands) shell.register(command);
  return shell;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(ready => { resolve = ready; });
  return { promise, resolve };
}

const routes: readonly [string, Factory, string, string][] = [
  ["aggregate definitions", createAgentCommands, "grep -E aa", "grep"],
  ["aggregate plugin", agentCommands, "egrep aa", "grep"],
  ["grep", grepCommands, "grep -E aa", "grep"],
  ["standard definitions", createStandardCommands, "grep -E aa", "grep"],
  ["standard plugin", standardCommands, "grep -E aa", "grep"],
  ["rg", options => [rgCommand(options)], "rg -F aa", "rg"],
  ["search definitions", createSearchCommands, "rg -F aa", "rg"],
  ["search plugin", searchCommands, "rg -F aa", "rg"],
  ["expr", options => [createExprCommand(options)], "expr aa : 'a*'", "expr-match"],
  ["expr definitions", createExprCommands, "expr aa : 'a*'", "expr-match"],
  ["expr plugin", exprCommands, "expr aa : 'a*'", "expr-match"],
  ["egrep", options => [egrepCommand(options)], "egrep aa", "grep"],
  ["fgrep", options => [fgrepCommand(options)], "fgrep aa", "grep"],
  ["alias definitions", createGrepAliasCommands, "egrep aa", "grep"],
  ["alias plugin", grepAliasCommands, "fgrep aa", "grep"],
];

test("common factory graphs do not import the Node regex client", async () => {
  const result = await build({
    entryPoints: ["plugins/index.ts", "commands/grep.ts", "commands/search/rg.ts", "commands/expr/index.ts"]
      .map(path => new URL(`../../src/${path}`, import.meta.url).pathname),
    bundle: true, platform: "node", format: "esm", write: false, metafile: true,
    outdir: "/virtual-factory-graph", external: ["node:*", "poe-code/safe-fs/core"],
  });
  for (const path of Object.keys(result.metafile!.inputs)) {
    assert.ok(!path.endsWith("/regex-execution/client.ts"), path);
  }
});

for (const [name, factory] of routes.slice(0, 2)) {
  test(`${name} defaults to the full bounded inventory with expr matching`, async () => {
    const shell = install(factory({}));
    try {
      assert.equal(expectedNames.length, 105);
      const result = await shell.exec("printf 'aa\\nbb\\n' | egrep 'a+' | fgrep aa | rg -F aa; expr aa : 'a*'; env expr 2 + 3");
      assert.deepEqual(shell.commands.list().map(command => command.name).sort(), expectedNames);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "aa\n2\n5\n");
      assert.equal(result.stderr, "");
      const insensitive = await shell.exec("grep -i a", { stdin: "aa\nAA\nbb\n" });
      assert.equal(insensitive.exitCode, 0, insensitive.stderr);
      assert.equal(insensitive.stdout, "aa\nAA\n");
      assert.equal(insensitive.stderr, "");
      for (const command of ["grep -w a", "rg 'a+'", "expr aa : '\\w'"]) {
        const unsupported = await shell.exec(command, { stdin: "aa\n" });
        assert.equal(unsupported.exitCode, 2, command);
        assert.match(unsupported.stderr, /unsupported/u, command);
      }
    } finally { await shell.dispose(); }
  });
}

for (const [name, factory, command, kind] of routes) {
  test(`${name} uses defaults and honors injected providers and lowered bounds`, async context => {
    const defaultShell = install(factory({}));
    try {
      const result = await defaultShell.exec(command, { stdin: "aa\n" });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, kind === "expr-match" ? "2\n" : "aa\n");
    } finally { await defaultShell.dispose(); }
    const backing = createBoundedRegexProvider({ maxPatternBytes: 1 });
    const requests: RegexWorkerRequest[] = [];
    let retired = 0;
    const regexExecutor = {
      dispose: context.mock.fn(async () => {}),
      createWorker(policy: Readonly<RegexExecutor["options"]>) {
        const worker = backing.createWorker(policy);
        const postMessage = worker.postMessage.bind(worker);
        const terminate = worker.terminate.bind(worker);
        worker.postMessage = request => { requests.push(request); postMessage(request); };
        worker.terminate = async () => { await terminate(); retired++; };
        return worker;
      },
    };
    const shell = install(factory({ regexExecutor }));
    try {
      const result = await shell.exec(command, { stdin: "aa\n" });
      assert.ok(requests.length > 0, name);
      assert.ok(requests.every(request => request.descriptor.kind === kind), name);
      assert.equal(result.exitCode, kind === "expr-match" ? 3 : 2, result.stderr);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /limit/u);
    } finally { await shell.dispose(); }
    assert.equal(retired, 1);
    assert.equal(regexExecutor.dispose.mock.callCount(), 0);
    assert.throws(() => {
      const invalid = factory({ regexExecutor: null! });
      if ("setup" in invalid) invalid.setup({ commands: new CommandRegistry(), use() {}, registerFileSystem() {} });
    }, /provider/u);
  });
}

for (const separateSearch of [false, true]) {
  test(`aggregate executors share provider and ${separateSearch ? "separate" : "share"} search policy`, async context => {
    const opened: RegexExecutor[] = [];
    const open = RegexExecutor.prototype.open;
    context.mock.method(RegexExecutor.prototype, "open", function (this: RegexExecutor, signal: AbortSignal) {
      opened.push(this);
      return open.call(this, signal);
    });
    const regexExecutor = createBoundedRegexProvider();
    for (const factory of [agentCommands, createAgentCommands]) {
      opened.length = 0;
      const shell = install(factory({ regexExecutor, regex: { maxWorkers: 1 },
        ...(separateSearch ? { search: { regex: { maxWorkers: 3 } } } : {}),
      }));
      try {
        for (const command of ["grep -E a", "egrep a", "fgrep a", "expr aa : 'a*'", "rg -F a"]) {
          assert.equal((await shell.exec(command, { stdin: "aa\n" })).exitCode, 0, command);
        }
        assert.equal(opened.length, 5);
        assert.ok(opened.every(executor => executor.provider === regexExecutor));
        assert.ok(opened.slice(0, 4).every(executor => executor === opened[0]));
        assert.equal(opened[0] === opened[4], !separateSearch);
        assert.deepEqual(opened.map(executor => executor.options.maxWorkers), [1, 1, 1, 1, separateSearch ? 3 : 1]);
      } finally { await shell.dispose(); }
    }
  });
}

test("aggregate replacement, collision and eager limits retain atomic registration", async () => {
  const commands = new CommandRegistry([{ name: "jq", execute: () => ({ exitCode: 17 }) }, { name: "custom", execute: () => ({ exitCode: 23 }) }]);
  const host = { commands, use() {}, registerFileSystem() {} };
  const before = commands.list();
  const plugin = agentCommands();
  try {
    assert.throws(() => plugin.setup(host), /already registered: jq/u);
    assert.deepEqual(commands.list(), before);
  } finally { await plugin.dispose?.(); }
  const invalid = agentCommands({ structured: { limits: { maxSteps: 0 } } });
  try {
    assert.throws(() => invalid.setup(host), /positive/u);
    assert.deepEqual(commands.list(), before);
  } finally { await invalid.dispose?.(); }
  const custom = commands.get("custom");
  const replacement = agentCommands({ replace: true });
  await replacement.setup(host);
  assert.equal(commands.list().length, 106);
  assert.equal(commands.get("custom"), custom);
  await replacement.dispose?.();
  assert.throws(() => replacement.setup(host), /disposed/u);
});

test("aggregate disposal preserves a shared provider and caller-owned endpoint", async context => {
  const regexExecutor = { ...createBoundedRegexProvider(), dispose: context.mock.fn(async () => {}) };
  const caller = regexExecutor.createWorker(defaults);
  const terminate = context.mock.method(caller, "terminate");
  const first = install(agentCommands({ regexExecutor }));
  const second = install(agentCommands({ regexExecutor }));
  try {
    assert.equal((await first.exec("egrep a", { stdin: "aa\n" })).stdout, "aa\n");
    await first.dispose();
    assert.equal((await second.exec("expr aa : 'a*'")).stdout, "2\n");
    await second.dispose();
    assert.equal(terminate.mock.callCount(), 0);
    assert.equal(regexExecutor.dispose.mock.callCount(), 0);
  } finally { await Promise.all([first.dispose(), second.dispose(), caller.terminate()]); }
});

for (const action of ["cancel", "dispose"] as const) {
  test(`aggregate ${action} waits for both executor retirements without owning the provider`, { timeout: 3000 }, async context => {
    const submitted = deferred(), retiring = deferred(), release = deferred();
    const events: EventEmitter[] = [];
    let submissions = 0, retirements = 0;
    const regexExecutor = {
      dispose: context.mock.fn(async () => {}),
      createWorker() {
        const worker = new EventEmitter();
        events.push(worker);
        queueMicrotask(() => worker.emit("message", { ready: true }));
        return Object.assign(worker, {
          postMessage() { if (++submissions === 2) submitted.resolve(); },
          async terminate() { if (++retirements === 2) retiring.resolve(); await release.promise; },
        });
      },
    };
    const plugin = agentCommands({ regexExecutor, search: { regex: { maxWorkers: 1 } } });
    assert.equal(typeof plugin.dispose, "function");
    const shell = install(plugin);
    const controller = new AbortController();
    const reason = new Error("cancel both executors");
    let settled = 0;
    const running = ["grep -E a", "rg -F a"].map(command => shell.exec(command, { stdin: "aa\n", signal: controller.signal })
      .finally(() => { settled++; }));
    const outcomes = running.map(request => action === "cancel" ? assert.rejects(request, error => error === reason) : request);
    let disposal: void | Promise<void> = undefined;
    try {
      await submitted.promise;
      if (action === "cancel") controller.abort(reason);
      else { disposal = plugin.dispose?.(); assert.equal(plugin.dispose?.(), disposal); }
      await retiring.promise;
      assert.equal(settled, 0);
      assert.equal(regexExecutor.dispose.mock.callCount(), 0);
      release.resolve();
      await Promise.all(outcomes);
      await disposal;
      if (action === "dispose") for (const request of running) {
        const result = await request;
        assert.equal(result.exitCode, 2);
        assert.match(result.stderr, /executor is disposed/u);
      }
      assert.equal(retirements, 2);
      assert.ok(events.every(worker => worker.eventNames().length === 0));
      assert.equal(controller.signal.aborted, action === "cancel");
    } finally {
      release.resolve();
      await Promise.allSettled(running);
      await shell.dispose();
    }
  });
}
