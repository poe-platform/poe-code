import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { type Codec } from "poe-code/ssconvert";
import { createCommandArguments, type CommandContext } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { createSsconvertCommand, ssconvertCommands } from "../../src/commands/ssconvert/index.js";

const encode = (value: string) => new TextEncoder().encode(value);
const fixture: Codec = {
  id: "independent", description: "Original one-cell fixture", extensions: ["independent"],
  probeContent: () => true,
  async read(bytes) { return { sheets: [{ id: "s", name: "Original", cells: [{ row: 0, column: 0,
    value: { kind: "string", value: new TextDecoder().decode(bytes) } }] }] }; },
  async write(book) {
    const value = book.sheets[0]!.cells[0]!.value;
    return encode(value.kind === "string" ? value.value : "");
  }
};
const options = { codecs: [fixture],
  limits: { inputBytes: 1000, outputBytes: 1000, cells: 10, sheets: 2, operations: 100 },
  environment: { env: {}, locale: "C", timezone: "UTC" } };

function invocation(args: readonly string[], overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = { command: "ssconvert", args, fs: new MemoryFileSystem(), cwd: "/",
    env: {}, signal: new AbortController().signal, stdin: (async function* () {})(), stdinIsDefault: true,
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } }, ...overrides };
  return { context, stdout, stderr };
}

test("ssconvert plugin owns descriptor bindings before caller mutation", async () => {
  const descriptors = { 4: { source: [encode("original")] } };
  const io = { descriptors };
  const command = createSsconvertCommand({ ...options, io });
  descriptors[4].source = [encode("mutated")];
  io.descriptors = { 4: { source: [encode("replaced")] } };
  const call = invocation(["-T", "independent", "fd://4", "fd://1"]);
  assert.equal((await command.execute(call.context)).exitCode, 0);
  assert.deepEqual(call.stdout, [encode("original")]);
  assert.deepEqual(call.stderr, []);
});

test("ssconvert retains adapter selection and bound transport hooks after caller map mutation", async () => {
  const visits: string[] = [];
  const adapters = { original: {
    async read() { visits.push("adapter"); return [encode("adapter-original")]; },
    async write(): Promise<void> { throw new Error("unexpected adapter write"); }
  } };
  const transport = {
    identity: "bound-original", redirects: 0,
    async authorize() { visits.push(this.identity); },
    async request() { visits.push("request"); return { source: [encode("transport-original")] }; }
  };
  const command = createSsconvertCommand({ ...options, io: { adapters, transport } });
  adapters.original = { async read() { throw new Error("replaced adapter"); }, async write() {} };
  transport.authorize = async () => { throw new Error("replaced authorization"); };
  transport.request = async () => { throw new Error("replaced request"); };
  for (const [uri, expected] of [["original:input", "adapter-original"], ["https://original.invalid/input", "transport-original"]]) {
    const call = invocation(["-T", "independent", uri!, "fd://1"]);
    assert.equal((await command.execute(call.context)).exitCode, 0);
    assert.deepEqual(call.stdout, [encode(expected!)]); assert.deepEqual(call.stderr, []);
  }
  assert.deepEqual(visits, ["adapter", "bound-original", "request"]);
});

test("ssconvert forwards distinct invalid raw option bytes without display reconstruction", async () => {
  const command = createSsconvertCommand(options);
  for (const value of [255, 254]) {
    const raw = new Uint8Array([45, 45, value]);
    const carrier = createCommandArguments([shellValueFromBytes(raw)]);
    raw.fill(0);
    const call = invocation(carrier.args, { argumentValues: carrier });
    assert.equal((await command.execute(call.context)).exitCode, 1);
    assert.deepEqual(call.stdout, []);
    assert.equal(new TextDecoder().decode(Buffer.concat(call.stderr)),
      `[Invalid UTF-8] Unknown option --\\x${value.toString(16)}\nRun 'ssconvert --help' to see a full list of available command line options.\n`);
  }
});

test("ssconvert collision preflight changes no namespace and explicit replacement registers literal name", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  const original = { name: "ssconvert", async execute() { return { exitCode: 17 }; } };
  shell.commands.register(original);
  const before = shell.commands.list().map(command => command.name);
  try {
    assert.throws(() => ssconvertCommands(options).setup(shell), /Command already registered: ssconvert/);
    assert.deepEqual(shell.commands.list().map(command => command.name), before);
    assert.equal((await shell.exec("ssconvert")).exitCode, 17);
    ssconvertCommands({ ...options, replace: true }).setup(shell);
    assert.deepEqual(shell.commands.list().map(command => command.name), before);
    const result = await shell.exec("ssconvert --help");
    assert.equal(result.exitCode, 0); assert.match(result.stdout, /Usage:/); assert.equal(result.stderr, "");
    assert.equal(shell.commands.has("SSCONVERT"), false);
  } finally { await shell.dispose(); }
});

test("ssconvert diagnostics use the enrolled stderr destination and reject closed consumers", async () => {
  const diagnostics: Uint8Array[] = [];
  const consumer = new AbortController();
  let rawWrites = 0;
  const call = invocation(["--independent-invalid"], {
    stderr: {
      async write() { rawWrites++; throw new Error("unenrolled stderr route"); },
      ownedOutput: {
        consumerClosed: consumer.signal,
        async write(bytes) { diagnostics.push(new Uint8Array(bytes)); }
      }
    }
  });
  const command = createSsconvertCommand(options);
  assert.equal((await command.execute(call.context)).exitCode, 1);
  assert.equal(new TextDecoder().decode(Buffer.concat(diagnostics)),
    "Unknown option --independent-invalid\nRun 'ssconvert --help' to see a full list of available command line options.\n");
  assert.equal(rawWrites, 0);
  const reason = new Error("stderr consumer closed");
  consumer.abort(reason);
  await assert.rejects(async () => command.execute(call.context), error => error === reason);
  assert.equal(diagnostics.length, 1);
  assert.equal(rawWrites, 0);
  assert.deepEqual(call.stdout, []);
});

test("ssconvert cancellation drains admitted stderr writes before invocation settlement", async () => {
  const controller = new AbortController();
  const consumer = new AbortController();
  const reason = new Error("cancel pending diagnostic");
  let admitted!: () => void, release!: () => void;
  const admission = new Promise<void>(resolve => { admitted = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const cleanups: (() => void | Promise<void>)[] = [];
  let rawWrites = 0, completed = false, settled = false;
  const call = invocation(["--independent-invalid"], {
    signal: controller.signal,
    registerCleanup(cleanup) { cleanups.push(cleanup); },
    stderr: {
      async write() { rawWrites++; },
      ownedOutput: {
        consumerClosed: consumer.signal,
        async write() {
          assert.ok(cleanups.length > 0);
          admitted();
          await pending;
          completed = true;
        }
      }
    }
  });
  const execution = createSsconvertCommand(options).execute(call.context);
  const rejection = assert.rejects(async () => execution, error => error === reason);
  void Promise.resolve(execution).then(() => { settled = true; }, () => { settled = true; });
  await admission;
  controller.abort(reason);
  const cleanup = Promise.all(cleanups.map(close => close()));
  await new Promise<void>(resolve => { setImmediate(resolve); });
  assert.equal(settled, false);
  assert.equal(completed, false);
  release();
  await rejection;
  await cleanup;
  assert.equal(completed, true);
  assert.equal(rawWrites, 0);
  assert.deepEqual(call.stdout, []);
});

test("ssconvert explicit plugin is available with ordinary agent shell invocation", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands()).use(ssconvertCommands(options));
  try {
    const result = await shell.exec("printf 'agent input' | ssconvert -T independent fd://0 fd://1");
    assert.equal(result.exitCode, 0); assert.equal(result.stderr, ""); assert.equal(result.stdout, "agent input");
  } finally { await shell.dispose(); }
});

test("ssconvert public Shell diagnostics resolve resource identity against VFS cwd independently of PWD", async () => {
  const environments: Readonly<Record<string, string>>[] = [
    { PWD: "/reported", KEEP: "original" }, { PWD: "relative", KEEP: "original" }, { KEEP: "original" }
  ];
  for (const env of environments) {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    await fs.writeFile("/work/input.independent", encode("original"));
    await fs.writeFile("/work/keep", encode("untouched"));
    const shell = new Shell({ fs, cwd: "/work" }).use(ssconvertCommands(options));
    shell.commands.register({ name: "exact-env", async execute(context) {
      return context.invoke!("ssconvert", context.args, { replaceEnv: true, env });
    } });
    try {
      const missing = await shell.exec("exact-env 'missing #.independent' output.independent");
      assert.equal(missing.exitCode, 1);
      assert.equal(missing.stdout, "");
      assert.equal(missing.stderr, "E /work/missing #.independent: No such file or directory\n");
      const exporter = await shell.exec("exact-env input.independent 'output #.unknown'");
      assert.equal(exporter.exitCode, 2);
      assert.equal(exporter.stdout, "");
      assert.equal(exporter.stderr, "Unable to guess exporter to use for 'file:///work/output%20%23.unknown'.\nTry --list-exporters to see a list of possibilities.\n");
      const absolute = await shell.exec("exact-env /elsewhere.independent output.independent");
      assert.equal(absolute.exitCode, 1);
      assert.equal(absolute.stderr, "E /elsewhere.independent: No such file or directory\n");
      assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["input.independent", "keep"]);
      assert.deepEqual(await fs.readFile("/work/input.independent"), encode("original"));
      assert.deepEqual(await fs.readFile("/work/keep"), encode("untouched"));
    } finally { await shell.dispose(); }
  }
});

test("ssconvert uses a logical PWD only when its directory identity matches the actual cwd", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/physical/actual", { recursive: true });
  await fs.mkdir("/logical");
  await fs.symlink("/physical/actual", "/logical/alias");
  await fs.writeFile("/physical/actual/input.independent", encode("original"));
  const shell = new Shell({ fs, cwd: "/physical/actual" }).use(ssconvertCommands(options));
  shell.commands.register({ name: "exact-env", async execute(context) {
    return context.invoke!("ssconvert", context.args, { replaceEnv: true, env: { PWD: "/logical/alias" } });
  } });
  try {
    const missing = await shell.exec("exact-env 'missing #.independent' output.independent");
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.stderr, "E /logical/alias/missing #.independent: No such file or directory\n");
    const exporter = await shell.exec("exact-env input.independent 'output #.unknown'");
    assert.equal(exporter.exitCode, 2);
    assert.equal(exporter.stderr, "Unable to guess exporter to use for 'file:///logical/alias/output%20%23.unknown'.\nTry --list-exporters to see a list of possibilities.\n");
    const output = await shell.exec("exact-env input.independent ../output.independent");
    assert.equal(output.exitCode, 0, output.stderr);
    assert.deepEqual(await fs.readFile("/logical/output.independent"), encode("original"));
    assert.deepEqual((await fs.readdir("/physical")).map(entry => entry.name), ["actual"]);
    assert.deepEqual((await fs.readdir("/logical")).map(entry => entry.name).sort(), ["alias", "output.independent"]);
  } finally { await shell.dispose(); }
});

test("ssconvert VFS cwd remains distinct from exact invocation exports and GETENV(PWD)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/input.independent", encode("original"));
  const observed: Readonly<Record<string, string>>[] = [];
  const codec: Codec = { ...fixture, async read(_bytes, context) {
    observed.push(context.environment.env);
    return { sheets: [{ id: "s", name: "Original", cells: [{ row: 0, column: 0,
      formula: '=GETENV("PWD")', formulaDirty: true, value: { kind: "string", value: "cached" } }] }] };
  } };
  const shell = new Shell({ fs, cwd: "/work" }).use(ssconvertCommands({ ...options, codecs: [codec],
    environment: { ...options.environment, env: { CONFIGURED: "private" } } }));
  shell.commands.register({ name: "exact-env", async execute(context) {
    return context.invoke!("ssconvert", ["--recalc", "-T", "Gnumeric_stf:stf_csv", "input.independent", "fd://1"], {
      replaceEnv: true, env: { PWD: "/reported", EXPORTED: "value" }
    });
  } });
  try {
    const result = await shell.exec("exact-env");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "/reported\n");
    assert.deepEqual(observed, [{ PWD: "/reported", EXPORTED: "value" }]);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["input.independent"]);
    assert.deepEqual(await fs.readFile("/work/input.independent"), encode("original"));
  } finally { await shell.dispose(); }
});

test("ssconvert preserves actual Shell default and pipeline stdin provenance independently of bytes", async () => {
  const observed: (boolean | undefined)[] = [];
  const codec: Codec = { ...fixture, async read(bytes, context) {
    observed.push(context.stdinIsDefault);
    return fixture.read!(bytes, context);
  } };
  const binding = { ...options, codecs: [codec] };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands()).use(ssconvertCommands(binding));
  try {
    for (const source of ["ssconvert -T independent fd://0 fd://1",
      "printf '' | ssconvert -T independent fd://0 fd://1"]) {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
    }
    const call = invocation(["-T", "independent", "fd://0", "fd://1"]);
    const customContext = { ...call.context };
    delete customContext.stdinIsDefault;
    assert.equal((await createSsconvertCommand(binding).execute(customContext)).exitCode, 0);
    assert.deepEqual(observed, [true, false, undefined]);
  } finally { await shell.dispose(); }
});

test("ssconvert cancellation drains cooperative codec ownership before rejection", async () => {
  const controller = new AbortController(), reason = new Error("independent cancellation");
  let admitted!: () => void;
  const admission = new Promise<void>(resolve => { admitted = resolve; });
  let cleanupCount = 0;
  const codec: Codec = { ...fixture, async read(_bytes, context) {
    context.own(async () => { cleanupCount++; });
    admitted();
    await new Promise<void>((_resolve, reject) => {
      context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
    });
    throw new Error("unreachable");
  } };
  const call = invocation(["-T", "independent", "fd://0", "fd://1"], {
    signal: controller.signal, stdin: (async function* () { yield encode("original"); })(), stdinIsDefault: false
  });
  const execution = createSsconvertCommand({ ...options, codecs: [codec] }).execute(call.context);
  await admission; controller.abort(reason);
  await assert.rejects(async () => execution, error => error === reason);
  assert.equal(cleanupCount, 1); assert.deepEqual(call.stdout, []); assert.deepEqual(call.stderr, []);
});

test("ssconvert registers cleanup synchronously before VFS acquisition and drains codec resources", async () => {
  const volume = Volume.fromJSON({ "/work/input.independent": "original", "/keep": "unchanged" });
  const events: string[] = [], cleanups: (() => void | Promise<void>)[] = [];
  const fs = new Proxy(new MemoryFileSystem(), { get(target, key) {
      // This memfs/mock host supplies buffered I/O, not the backing MemoryFileSystem streams.
      if (key === "readStream" || key === "writeStream") return undefined;
      if (key === "capabilities") return { ...target.capabilities, streamingRead: false, streamingWrite: false };
    if (key === "readFile") return async (path: string, supplied?: { signal?: AbortSignal }) => {
      assert.ok(cleanups.length > 0); events.push("read"); supplied?.signal?.throwIfAborted();
      return new Uint8Array(volume.readFileSync(path) as Uint8Array);
    };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const codec: Codec = { ...fixture, async read(bytes, context) {
    events.push("acquire"); context.own(async () => { events.push("cleanup"); });
    return fixture.read!(bytes, context);
  } };
  const call = invocation(["-T", "independent", "input.independent", "fd://1"], { cwd: "/work", fs,
    registerCleanup(cleanup) { events.push("register"); cleanups.push(cleanup); } });
  assert.equal((await createSsconvertCommand({ ...options, codecs: [codec] }).execute(call.context)).exitCode, 0);
  assert.deepEqual(call.stdout, [encode("original")]);
  assert.ok(events.indexOf("register") < events.indexOf("read"));
  assert.equal(events.filter(event => event === "cleanup").length, 1);
  await Promise.all(cleanups.map(cleanup => cleanup()));
  assert.equal(events.filter(event => event === "cleanup").length, 1);
  assert.deepEqual(volume.toJSON(), { "/work/input.independent": "original", "/keep": "unchanged" });
});
