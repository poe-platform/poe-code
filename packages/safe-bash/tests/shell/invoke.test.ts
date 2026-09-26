import assert from "node:assert/strict";
import { createProcessSignalChannel } from "safe-bash-contracts/process";
import { test } from "node:test";
import { toByteSource, writeText } from "../../src/contracts/index.js";
import type { CommandContext } from "../../src/contracts/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import type { ShellCommandContext } from "../../src/shell/index.js";
import { setup } from "./helpers.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { truncateCommands } from "../../src/commands/truncate/index.js";

test("plugin command contexts retain own enumerable capabilities through object spread", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs });
  let checked = false;
  shell.use({ name: "context-spread", setup(host) {
    host.commands.register({ name: "context-spread", async execute(context) {
      for (const name of ["fs", "inputBudget", "shellPredicates", "admittedHandles", "stdinInput", "stdoutFile"]) {
        assert.equal(Object.getOwnPropertyDescriptor(context, name)?.enumerable, true, name);
      }
      const forwarded = { ...context };
      assert.equal(forwarded.fs, context.fs);
      assert.equal(forwarded.inputBudget, context.inputBudget);
      assert.equal(forwarded.shellPredicates, context.shellPredicates);
      assert.equal(forwarded.admittedHandles, context.admittedHandles);
      assert.equal(forwarded.stdinInput, context.stdinInput);
      assert.equal(forwarded.stdoutFile, context.stdoutFile);
      const descriptorCopy = Object.create(Object.getPrototypeOf(context), Object.getOwnPropertyDescriptors(context)) as typeof context;
      assert.equal(descriptorCopy.fs, context.fs);
      assert.equal(descriptorCopy.inputBudget, context.inputBudget);
      assert.equal(descriptorCopy.shellPredicates, context.shellPredicates);
      assert.equal(descriptorCopy.admittedHandles, context.admittedHandles);
      assert.equal(descriptorCopy.stdinInput, context.stdinInput);
      assert.equal(descriptorCopy.stdoutFile, context.stdoutFile);
      assert.equal(forwarded.stdoutFile?.path, "/output");
      forwarded.inputBudget!.check(2);
      assert.deepEqual((await forwarded.stdinInput!.read(2, forwarded.signal)).value, new TextEncoder().encode("in"));
      await forwarded.fs.writeFile("/copied", new TextEncoder().encode("yes"));
      checked = true;
      return { exitCode: 0 };
    } });
  } });
  try {
    const result = await shell.exec("context-spread > /output", { stdin: "in" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(checked, true);
    assert.equal(new TextDecoder().decode(await fs.readFile("/copied")), "yes");
  } finally { await shell.dispose(); }
});

for (const middleware of [false, true]) test(`plugin descriptor admission retires with its command before the first lease with middleware=${middleware}`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  if (middleware) shell.use((_context, next) => next());
  let retained: CommandContext["admittedHandles"];
  let checked = false;
  shell.use({ name: "retired-descriptor-admission", setup(host) {
    host.commands.register({ name: "retain-admission", execute(context) {
      retained = context.admittedHandles;
      return { exitCode: 0 };
    } });
    host.commands.register({ name: "acquire-late", async execute(context) {
      assert.ok(retained);
      await assert.rejects(retained.acquire(0, ["read"], context.signal), { code: "EBADF" });
      checked = true;
      return { exitCode: 0 };
    } });
  } });
  try {
    const result = await shell.exec("retain-admission; acquire-late");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(checked, true);
  } finally { await shell.dispose(); }
});

for (const stdin of [undefined, "input"]) test(`plugin command contexts preserve stdin provenance through invoke: ${stdin === undefined ? "default" : "explicit"}`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  let checked = false;
  shell.use({ name: "context-provenance", setup(host) {
    host.commands.register({ name: "check-provenance", execute(context) {
      assert.equal(Object.hasOwn(context, "stdinIsDefault"), true);
      assert.equal(context.stdinIsDefault, stdin === undefined);
      checked = true;
      return { exitCode: 0 };
    } });
    host.commands.register({ name: "forward-provenance", execute: context => context.invoke!("check-provenance", []) });
  } });
  try {
    const result = await shell.exec("forward-provenance", stdin === undefined ? {} : { stdin });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(checked, true);
  } finally { await shell.dispose(); }
});

for (const middleware of [false, true]) test(`plugin pipeline stages retain the terminal field through object spread with middleware=${middleware}`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  if (middleware) shell.use((_context, next) => next());
  let checked = false;
  shell.use({ name: "context-terminal", setup(host) {
    host.commands.register({ name: "check-terminal", execute(context) {
      const original = context as unknown as { terminal?: object };
      const forwarded = { ...original };
      assert.equal(Object.hasOwn(original, "terminal"), true);
      assert.equal(original.terminal, undefined);
      assert.equal(forwarded.terminal, original.terminal);
      checked = true;
      return { exitCode: 0 };
    } });
  } });
  try {
    const result = await shell.exec("check-terminal | :");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(checked, true);
  } finally { await shell.dispose(); }
});

for (const [source, stdout, contents] of [
  ["cat /file", "abc\n", "abc\n"],
  ["truncate -s 1 /file", "", "a"],
  ["html-to-markdown /page", "**hi**\n", "abc\n"],
  ["DU_BLOCK_SIZE=1 du --apparent-size /file", "4\t/file\n", "abc\n"],
  ["zip -q /archive.zip /file && unzip -p /archive.zip file", "abc\n", "abc\n"],
] as const) test(`default commands retain spread context capabilities: ${source}`, async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  await fs.writeFile("/file", new TextEncoder().encode("abc\n"));
  await fs.writeFile("/page", new TextEncoder().encode("<b>hi</b>"));
  try {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, stdout);
    assert.equal(new TextDecoder().decode(await fs.readFile("/file")), contents);
  } finally { await shell.dispose(); }
});

for (const middleware of [false, true]) test(`optional truncate preserves the invocation environment through cleanup with middleware=${middleware}`, async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands()).use(truncateCommands({ replace: true }));
  if (middleware) shell.use((_context, next) => next());
  try {
    const resized = await shell.exec("truncate -o -s 1 /blocks");
    assert.deepEqual([resized.exitCode, resized.stdout, resized.stderr], [0, "", ""]);
    const blocks = await fs.stat("/blocks");
    assert.equal(blocks.ioBlockSize, 65536);
    assert.equal(blocks.size, blocks.ioBlockSize);
    assert.deepEqual(await fs.readFile("/blocks"), new Uint8Array(65536));

    const posix = await shell.exec("POSIXLY_CORRECT=1 truncate /absent -s1 2>/diagnostic");
    assert.deepEqual([posix.exitCode, posix.stdout, posix.stderr], [1, "", ""]);
    assert.equal(new TextDecoder().decode(await fs.readFile("/diagnostic")),
      "truncate: you must specify either '--size' or '--reference'\nTry 'truncate --help' for more information.\n");
    await assert.rejects(fs.stat("/absent"), { code: "ENOENT" });
  } finally { await shell.dispose(); }
});

test("descriptor leases return an available fragment without filling the request", async () => {
  const { shell, commands } = setup();
  let pulls = 0;
  commands.register({ name: "available-fd", async execute(context) {
    const lease = await context.admittedHandles!.acquire(0, ["read"], context.signal);
    try {
      assert.deepEqual(await lease.read!(0, context.signal), { done: false, value: new Uint8Array() });
      assert.equal(pulls, 0);
      assert.deepEqual(await lease.read!(1024, context.signal), { done: false, value: new Uint8Array([0, 255, 7]) });
      assert.equal(pulls, 1);
    } finally { await lease.close(); }
    return { exitCode: 0 };
  } });
  const stdin = { [Symbol.asyncIterator]() { return {
    async next() {
      if (++pulls > 1) throw new Error("Native reads must return available bytes");
      return { done: false as const, value: new Uint8Array([0, 255, 7]) };
    },
    async return() { return { done: true as const, value: undefined }; },
  }; } };
  try { const result = await shell.exec("available-fd", { stdin }); assert.equal(result.exitCode, 0, result.stderr); }
  finally { await shell.dispose(); }
});

test("duplicate descriptor leases share the retained cursor and close independently", async () => {
  const { shell, commands, fs } = setup();
  await fs.writeFile("/lease-input", new Uint8Array([1, 2, 3]));
  commands.register({ name: "aliased-fd", async execute(context) {
    const first = await context.admittedHandles!.acquire(4, ["read"], context.signal);
    const second = await context.admittedHandles!.acquire(5, ["read"], context.signal);
    try {
      assert.equal(first.identity, second.identity);
      assert.deepEqual((await first.read!(1, context.signal)).value, new Uint8Array([1]));
      await first.close();
      assert.deepEqual((await second.read!(2, context.signal)).value, new Uint8Array([2, 3]));
      await assert.rejects(context.admittedHandles!.acquire(5, ["write"], context.signal), { code: "EBADF" });
    } finally { await first.close(); await second.close(); }
    return { exitCode: 0 };
  } });
  try { const result = await shell.exec("aliased-fd 4</lease-input 5<&4"); assert.equal(result.exitCode, 0, result.stderr); }
  finally { await shell.dispose(); }
});

test("descriptor writes retain successful receipts while cancellation drains", async () => {
  for (const redirected of [false, true]) {
    const { shell, commands } = setup();
    const controller = new AbortController();
    const reason = new Error("cancel admitted write");
    const events: string[] = [];
    let enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    let release!: () => void;
    const draining = new Promise<void>(resolve => { release = resolve; });
    commands.register({ name: "receipt-fd", async execute(context) {
      const lease = await context.admittedHandles!.acquire(redirected ? 3 : 1, ["write"], context.signal);
      try {
        assert.equal(await lease.write!(new Uint8Array([1]), context.signal), 1);
        events.push("receipt");
        await assert.rejects(lease.write!(new Uint8Array([2]), context.signal), error => error === reason);
      } finally { await lease.close(); }
      return { exitCode: 0 };
    } });
    const execution = shell.exec(redirected ? "receipt-fd 3>&1" : "receipt-fd", {
      signal: controller.signal,
      stdout: { async write() { throw new Error("Use enrolled output"); }, ownedOutput: {
        consumerClosed: new AbortController().signal,
        async write() { enter(); await draining; events.push("accepted"); },
      } },
    });
    const outcome = execution.then(() => { throw new Error("Cancellation must reject"); }, error => { assert.equal(error, reason); });
    try {
      await entered; controller.abort(reason); release(); await outcome;
      assert.deepEqual(events, ["accepted", "receipt"]);
    } finally { release(); await shell.dispose(); }
  }
});

test("exec lends process signals to nested invoke and accepts explicit overrides", async () => {
  const { shell, commands } = setup();
  const parent = createProcessSignalChannel();
  const child = createProcessSignalChannel();
  commands.register({ name: "child-signals", async execute(context) {
    assert.equal(context.processSignals, child);
    return { exitCode: 42 };
  } });
  commands.register({ name: "inherited-signals", async execute(context) {
    assert.equal(context.processSignals, parent);
    return { exitCode: 43 };
  } });
  commands.register({ name: "parent-signals", async execute(context) {
    assert.equal(context.processSignals, parent);
    assert.equal((await context.invoke!("child-signals", [], { processSignals: child })).exitCode, 42);
    assert.equal(context.processSignals, parent);
    return context.invoke!("inherited-signals", []);
  } });
  try { assert.equal((await shell.exec("parent-signals", { processSignals: parent })).exitCode, 43); }
  finally { await shell.dispose(); }
});

test("invoke preserves literal argv and uses fresh middleware resolution", async () => {
  const { shell, commands, fs } = setup();
  const order: string[] = [];
  shell.use(async (context, next) => { order.push(context.command); return next(); });
  commands.register({ name: "invoke-test", async execute(context) {
    return (context as ShellCommandContext).invoke("args", ["", "two words", "$(say bad > touched)", ";", "*", "VALUE=literal", "'quotes'"]);
  } });
  assert.deepEqual(JSON.parse((await shell.exec("invoke-test")).stdout), ["", "two words", "$(say bad > touched)", ";", "*", "VALUE=literal", "'quotes'"]);
  assert.deepEqual(order, ["invoke-test", "args"]);
  await assert.rejects(fs.stat("/touched"));
});

test("invoke inherits stdin and supports byte sink overrides", async () => {
  const { shell, commands } = setup();
  const received: number[] = [];
  commands.register({ name: "invoke-test", async execute(context) {
    const host = context as ShellCommandContext;
    await host.invoke("pass", []);
    await host.invoke("pass", [], { stdin: toByteSource(new Uint8Array([255, 0])), stdout: { async write(chunk) { received.push(...chunk); } } });
    return host.invoke("status", ["7"]);
  } });
  const result = await shell.exec("invoke-test", { stdin: "parent" });
  assert.equal(result.stdout, "parent");
  assert.deepEqual(received, [255, 0]);
  assert.equal(result.exitCode, 7);
});

test("invoke isolates child cwd, environment, functions and exit flow", async () => {
  const { shell, fs, commands } = setup({ env: { VALUE: "parent" } });
  await fs.mkdir("/other");
  commands.register({ name: "invoke-test", async execute(context) {
    const host = context as ShellCommandContext;
    await host.invoke("pwd", [], { cwd: "/other" });
    await host.invoke("envget", ["VALUE"], { env: { VALUE: "child" } });
    await host.invoke("cd", ["/other"]);
    await host.invoke("export", ["VALUE=changed"]);
    await host.invoke("work", []);
    const status = await host.invoke("exit", ["9"]);
    assert.equal(status.exitCode, 9);
    await writeText(context.stdout, `${context.cwd}:${context.env.VALUE}`);
    return { exitCode: 0 };
  } });
  const result = await shell.exec('work() { VALUE=function; cd /other; }; invoke-test; pwd; envget VALUE');
  assert.equal(result.stdout, "/other\nchild/:parent/\nparent");
});

for (const externalInvocation of [undefined, false, true]) test(`invoke external mode is explicit and resets in nested children: ${externalInvocation}`, async () => {
  const { shell, commands } = setup();
  const options = externalInvocation === undefined ? {} : { externalInvocation };
  commands.register({ name: "pwd", async execute(context) {
    await writeText(context.stdout, `registered:${context.args.join("|")}\n`);
    return { exitCode: 0 };
  } });
  commands.register({ name: "nested", execute: context => context.invoke!("pwd", ["-L"], options) });
  commands.register({ name: "forward", async execute(context) {
    assert.equal((await context.invoke!("pwd", ["-L"], options)).exitCode, 0);
    return context.invoke!("nested", [], { externalInvocation: true });
  } });
  try {
    const result = await shell.exec("forward; pwd");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, (externalInvocation ? "registered:-L\n" : "/\n").repeat(2) + "/\n");
  } finally { await shell.dispose(); }
});

for (const externalInvocation of [undefined, false]) test(`invoke exact environment retains functions and parent state: ${externalInvocation}`, async () => {
  const { shell, commands } = setup({ env: { VALUE: "parent" } });
  commands.register({ name: "forward", execute: context => context.invoke!("work", ["literal;*"], {
    env: { VALUE: "child" }, replaceEnv: true,
    ...(externalInvocation === undefined ? {} : { externalInvocation }),
  }) });
  try {
    const result = await shell.exec('work() { args "$VALUE" "$1"; VALUE=changed; }; forward; args "$VALUE"');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, '["child","literal;*"]["parent"]');
  } finally { await shell.dispose(); }
});

test("invoke shares command and output budgets", async () => {
  const { shell, commands } = setup();
  commands.register({ name: "invoke-test", async execute(context) {
    const host = context as ShellCommandContext;
    for (let count = 0; count < 10; count++) await host.invoke("true", []);
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec("invoke-test", { limits: { maxCommands: 4 } }), (error) => error instanceof ShellLimitError && error.limit === "maxCommands");
  commands.register({ name: "invoke-bytes", async execute(context) {
    return (context as ShellCommandContext).invoke("bytes", [], { stdout: { async write() {} } });
  } });
  await assert.rejects(shell.exec("invoke-bytes", { limits: { maxOutputBytes: 2 } }), (error) => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
});

test("invoke propagates cancellation through nested commands", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const controller = new AbortController();
  let signal: AbortSignal | undefined;
  commands.register({ name: "invoke-test", async execute(context) {
    return (context as ShellCommandContext).invoke("waiting", []);
  } });
  commands.register({ name: "waiting", async execute(context) {
    signal = context.signal;
    controller.abort(new Error("cancel nested"));
    return new Promise(() => {});
  } });
  await assert.rejects(shell.exec("invoke-test", { signal: controller.signal }), /cancel nested/u);
  assert.equal(signal?.aborted, true);
});

test("invoke unknown commands and recursive hooks use normal statuses and limits", async () => {
  const { shell, commands } = setup();
  commands.register({ name: "missing", async execute(context) { return (context as ShellCommandContext).invoke("does-not-exist", []); } });
  assert.equal((await shell.exec("missing")).exitCode, 127);
  commands.register({ name: "recursive", async execute(context) { return (context as ShellCommandContext).invoke("recursive", []); } });
  await assert.rejects(shell.exec("recursive", { limits: { maxSubstitutionDepth: 4 } }), (error) => error instanceof ShellLimitError && error.limit === "maxSubstitutionDepth");
});
