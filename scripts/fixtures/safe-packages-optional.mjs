import assert from "node:assert/strict";
import { lstat, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as core from "@poe-platform/safe-bash";
import * as browser from "@poe-platform/safe-bash/browser";
import { createMemoryFileSystem, createMountFileSystem, FsError, scopeFileSystem } from "@poe-platform/safe-fs";
import * as optional from "@poe-platform/safe-bash-optional";

const consumer = dirname(fileURLToPath(import.meta.url));
const foreignRoot = process.argv[2];
assert.equal(process.argv.length, 3, "usage: node safe-packages-optional.mjs ABSOLUTE_SECOND_INSTALLED_CONSUMER");
assert.ok(foreignRoot && isAbsolute(foreignRoot));
assert.equal(await realpath(consumer), consumer);
assert.equal(await realpath(foreignRoot), foreignRoot);
assert.notEqual(foreignRoot, consumer);

async function installedEntry(root, name, resolvedEntry) {
  const packageRoot = join(root, "node_modules", name);
  const manifestPath = join(packageRoot, "package.json");
  const manifestStat = await lstat(manifestPath);
  assert.equal(manifestStat.isSymbolicLink(), false, manifestPath);
  assert.equal(manifestStat.isFile(), true, manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.name, name);
  if (resolvedEntry === undefined) assert.ok(typeof manifest.exports?.["."]?.import === "string" && manifest.exports["."].import.startsWith("./dist/"));
  const entry = resolvedEntry ?? resolve(packageRoot, manifest.exports["."].import);
  assert.ok(entry.startsWith(packageRoot + sep), `${name} must resolve inside its actual installed package`);
  let current = root;
  for (const component of relative(root, entry).split(sep)) {
    current = join(current, component);
    const stat = await lstat(current);
    assert.equal(stat.isSymbolicLink(), false, current);
    assert.equal(current === entry ? stat.isFile() : stat.isDirectory(), true, current);
  }
  assert.equal(await realpath(entry), entry);
  return { entry, manifest };
}

const installedCore = await installedEntry(consumer, "@poe-platform/safe-bash", fileURLToPath(import.meta.resolve("@poe-platform/safe-bash")));
const installedFs = await installedEntry(consumer, "@poe-platform/safe-fs", fileURLToPath(import.meta.resolve("@poe-platform/safe-fs")));
const installedOptional = await installedEntry(consumer, "@poe-platform/safe-bash-optional", fileURLToPath(import.meta.resolve("@poe-platform/safe-bash-optional")));
const optionalRequire = createRequire(installedOptional.entry);
assert.equal(installedOptional.manifest.peerDependencies["@poe-platform/safe-bash"], installedCore.manifest.version);
assert.equal(installedOptional.manifest.peerDependencies["@poe-platform/safe-fs"], installedFs.manifest.version);
assert.deepEqual(Object.keys(installedOptional.manifest.peerDependencies).sort(), ["@poe-platform/safe-bash", "@poe-platform/safe-fs", "yaml"]);
assert.deepEqual(Object.keys(installedOptional.manifest.dependencies ?? {}), []);
assert.equal(installedOptional.manifest.peerDependencies.yaml, "2.9.0");
assert.equal(installedOptional.manifest.peerDependenciesMeta.yaml.optional, true);
const installedYaml = await installedEntry(consumer, "yaml", optionalRequire.resolve("yaml"));
assert.equal(installedYaml.manifest.version, "2.9.0");

const factories = [
  ["yes", optional.createYesCommand, optional.createYesCommands, optional.yesCommands],
  ["cmp", optional.createCmpCommand, optional.createCmpCommands, optional.cmpCommands],
  ["dd", optional.createDdCommand, optional.createDdCommands, optional.ddCommands],
  ["shuf", optional.createShufCommand, optional.createShufCommands, optional.shufCommands],
  ["truncate", optional.createTruncateCommand, optional.createTruncateCommands, optional.truncateCommands],
  ["install", optional.createInstallCommand, optional.createInstallCommands, optional.installCommands],
  ["yq", optional.createYqCommand, optional.createYqCommands, optional.yqCommands],
];
const extensionNames = ["arraysExtension", "jobsExtension", "mapfileExtension", "readExtension", "trapExtension"];
assert.equal(optional.Shell, core.Shell);
assert.equal(optional.agentCommands, core.agentCommands);
assert.equal(core.FsError, FsError);
const definitions = factories.map(([name, create, createMany]) => {
  const definition = create();
  assert.equal(definition.name, name);
  assert.equal(definition.runtimeIdentity, core.commandRuntimeIdentity);
  const many = createMany();
  assert.deepEqual(many.map(command => command.name), [name]);
  assert.equal(many[0].runtimeIdentity, core.commandRuntimeIdentity);
  return definition;
});
const registry = new core.CommandRegistry(definitions);
const laterRegistry = new core.CommandRegistry();
for (const definition of definitions) {
  assert.equal(registry.has(definition.name), true);
  laterRegistry.register(definition);
  assert.equal(laterRegistry.has(definition.name), true);
}
for (const name of extensionNames) assert.equal(optional[name]().runtimeIdentity, core.commandRuntimeIdentity, name);
const defaultNames = core.createAgentCommands().map(command => command.name);
const browserNames = browser.createBrowserCommands().map(command => command.name);
assert.equal(defaultNames.length, 79);
assert.equal(new Set(defaultNames).size, 79);
assert.equal(browserNames.length, 28);
assert.equal(new Set(browserNames).size, 28);
for (const [name] of factories) {
  assert.equal(defaultNames.includes(name), false, name);
  assert.equal(browserNames.includes(name), false, name);
}
for (const name of [...extensionNames, "createDeviceFileSystem", "createYesCommand", "createCmpCommand", "createDdCommand", "createShufCommand", "createTruncateCommand", "createInstallCommand", "createYqCommand"]) {
  assert.equal(Object.hasOwn(core, name), false, name);
  assert.equal(Object.hasOwn(browser, name), false, name);
}

const foreignCoreArtifact = await installedEntry(foreignRoot, "@poe-platform/safe-bash");
const foreignFsArtifact = await installedEntry(foreignRoot, "@poe-platform/safe-fs");
const foreignOptionalArtifact = await installedEntry(foreignRoot, "@poe-platform/safe-bash-optional");
assert.equal(foreignCoreArtifact.manifest.version, installedCore.manifest.version);
assert.equal(foreignFsArtifact.manifest.version, installedFs.manifest.version);
assert.equal(foreignOptionalArtifact.manifest.version, installedOptional.manifest.version);
assert.equal(foreignOptionalArtifact.manifest.peerDependencies["@poe-platform/safe-bash"], foreignCoreArtifact.manifest.version);
assert.equal(foreignOptionalArtifact.manifest.peerDependencies["@poe-platform/safe-fs"], foreignFsArtifact.manifest.version);
assert.notEqual(foreignCoreArtifact.entry, installedCore.entry);
const foreignCore = await import(pathToFileURL(foreignCoreArtifact.entry).href);
const foreignFs = await import(pathToFileURL(foreignFsArtifact.entry).href);
const foreignOptional = await import(pathToFileURL(foreignOptionalArtifact.entry).href);
assert.notEqual(foreignCore.commandRuntimeIdentity, core.commandRuntimeIdentity);
assert.equal(foreignCore.FsError, foreignFs.FsError);
assert.notEqual(foreignFs.FsError, FsError);
assert.equal(foreignOptional.Shell, foreignCore.Shell);
assert.equal(foreignOptional.createYesCommand().runtimeIdentity, foreignCore.commandRuntimeIdentity);
await assert.rejects(optional.createDeviceFileSystem().readFile("/absent"), error => error instanceof FsError && error.code === "ENOENT");
await assert.rejects(foreignOptional.createDeviceFileSystem().readFile("/absent"), error => error instanceof foreignFs.FsError && error.code === "ENOENT");
const previousYes = registry.get("yes");
assert.throws(() => registry.register(foreignOptional.createYesCommand(), { replace: true }), /matching shell runtime/);
assert.equal(registry.get("yes"), previousYes);
for (const commands of [new foreignCore.CommandRegistry(), new foreignCore.CommandRegistry([foreignOptional.createYesCommand()])]) {
  assert.throws(() => new core.Shell({ fs: createMemoryFileSystem(), commands }), /matching shell runtime/);
}
for (const name of extensionNames) {
  const owner = {};
  let created = 0;
  let written = 0;
  const extension = foreignOptional[name]();
  try {
    owner.shell = new core.Shell({ fs: createMemoryFileSystem(), extensions: [{
      ...extension, create() { created++; return extension.create(); },
    }] }).use(core.agentCommands());
    await assert.rejects(owner.shell.exec(String.raw`printf forbidden; action=$'printf "\377"'; trap "$action" EXIT`, {
      stdout: { async write(bytes) { written += bytes.length; } },
    }), /matching shell runtime/);
    assert.equal(created, 0, name);
    assert.equal(written, 0, name);
  } finally { await owner.shell?.dispose(); }
}

for (const commands of [registry, laterRegistry]) {
  const owner = {};
  try {
    owner.shell = new core.Shell({ fs: createMemoryFileSystem(), commands });
    const result = await owner.shell.exec("shuf -e same-core");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "same-core\n");
  } finally { await owner.shell?.dispose(); }
}

{
  const owner = {};
  const fs = createMemoryFileSystem();
  const descriptors = [];
  const open = fs.open.bind(fs);
  fs.open = async (...args) => {
    const descriptor = await open(...args);
    const entry = { closes: 0 };
    descriptors.push(entry);
    const close = descriptor.close.bind(descriptor);
    descriptor.close = async () => { entry.closes++; await close(); };
    return descriptor;
  };
  try {
    owner.shell = new core.Shell({ fs, limits: { maxWallClockMs: 2000 } }).use(core.agentCommands());
    for (const [, , , plugin] of factories) owner.shell.use(plugin());
    assert.deepEqual(owner.shell.commands.list().map(command => command.name).filter(name => factories.some(([optionalName]) => optionalName === name)).sort(), factories.map(([name]) => name).sort());
    const yes = await owner.shell.exec(String.raw`yes $'\377' | head -c 3`);
    assert.equal(yes.exitCode, 0, yes.stderr);
    assert.equal(yes.stderr, "");
    assert.deepEqual(yes.stdoutBytes, Uint8Array.of(255, 10, 255));
    for (const [source, expected] of [[String.raw`shuf -e $'\377'`, Uint8Array.of(255, 10)], ["shuf -e 'é'", Uint8Array.of(195, 169, 10)]]) {
      const result = await owner.shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, expected);
    }
    const binary = Uint8Array.of(255, 0, 128, 65, 66, 67, 68, 69);
    await fs.writeFile("/input", binary);
    await fs.writeFile("/copy", binary);
    assert.equal((await owner.shell.exec("cmp -s /input /copy")).exitCode, 0);
    await fs.writeFile("/copy", Uint8Array.of(1, 0, 128, 65, 66, 67, 68, 69));
    const different = await owner.shell.exec("cmp -s /input /copy");
    assert.equal(different.exitCode, 1);
    assert.equal(different.stdout, "");
    assert.equal(different.stderr, "");
    await fs.writeFile("/output", Buffer.from("abcdefgh"));
    const copied = await owner.shell.exec("dd if=/input of=/output bs=2 count=3 conv=notrunc status=none");
    assert.equal(copied.exitCode, 0, copied.stderr);
    assert.equal(copied.stdout, "");
    assert.equal(copied.stderr, "");
    assert.deepEqual(await fs.readFile("/output"), Uint8Array.of(255, 0, 128, 65, 66, 67, 103, 104));
    assert.deepEqual(await fs.readFile("/input"), binary);
    const truncated = await owner.shell.exec("truncate -o -s 1 /blocks");
    assert.equal(truncated.exitCode, 0, truncated.stderr);
    const blocks = await fs.stat("/blocks");
    assert.equal(blocks.ioBlockSize, 65536);
    assert.equal(blocks.size, blocks.ioBlockSize);
    await fs.writeFile("/�", Uint8Array.of(1, 2, 3));
    const diagnostic = await owner.shell.exec(String.raw`truncate -s $'\377' /out`);
    assert.equal(diagnostic.exitCode, 1);
    assert.deepEqual(Buffer.from(diagnostic.stderrBytes), Buffer.from("truncate: Invalid number: '\\377'\n"));
    const invalid = await owner.shell.exec(String.raw`truncate -s 0 $'\377'`);
    assert.equal(invalid.exitCode, 1);
    assert.deepEqual(await fs.readFile("/�"), Uint8Array.of(1, 2, 3));
    await fs.utimes("/input", 1000.75, 2000.5);
    const installed = await owner.shell.exec("install -p -D -m 640 /input /nested/target && cmp /input /nested/target");
    assert.equal(installed.exitCode, 0, installed.stderr);
    assert.equal(installed.stdout, "");
    assert.equal(installed.stderr, "");
    assert.deepEqual(await fs.readFile("/nested/target"), binary);
    const target = await fs.stat("/nested/target");
    assert.equal(target.mode & 0o7777, 0o640);
    assert.equal(target.mtimeMs, 2000.5);
    await fs.writeFile("/settings.yaml", Buffer.from("# config\nbuild:\n  enabled: false\n"));
    const updated = await owner.shell.exec("yq -i '.build.enabled = true' /settings.yaml");
    assert.equal(updated.exitCode, 0, updated.stderr);
    assert.equal(updated.stdout, "");
    assert.equal(updated.stderr, "");
    assert.equal(Buffer.from(await fs.readFile("/settings.yaml")).toString(), "# config\nbuild:\n  enabled: true\n");
    const queried = await owner.shell.exec("yq -o=json -I=0 '.build' /settings.yaml");
    assert.equal(queried.exitCode, 0, queried.stderr);
    assert.equal(queried.stdout, '{"enabled":true}\n');
    assert.equal(queried.stderr, "");
    assert.ok(descriptors.length > 0);
    assert.ok(descriptors.every(entry => entry.closes === 1));
  } finally { await owner.shell?.dispose(); }
}

for (const [source, bytes, limit] of [
  ["dd if=/input of=/out bs=2 status=none", Buffer.from("abcdefgh"), 3],
  ["install /input /out", Uint8Array.of(255, 0, 128, 65), 2],
  ["shuf -e abc -o /out", new Uint8Array(), 1],
]) {
  const owner = {};
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", bytes);
  try {
    owner.shell = new core.Shell({ fs, limits: { maxOutputBytes: limit } }).use(optional.ddCommands()).use(optional.installCommands()).use(optional.shufCommands());
    await assert.rejects(owner.shell.exec(source), error => error instanceof core.ShellLimitError && error.limit === "maxOutputBytes");
    const output = await fs.readFile("/out").catch(error => {
      if (error instanceof FsError && error.code === "ENOENT") return new Uint8Array();
      throw error;
    });
    assert.ok(output.length <= limit);
    if (source.startsWith("dd ")) assert.deepEqual(output, Uint8Array.of(97, 98));
  } finally { await owner.shell?.dispose(); }
}

{
  const owner = {};
  const fs = createMemoryFileSystem();
  const original = Buffer.from("a: 1\n");
  await fs.writeFile("/settings.yaml", original);
  try {
    owner.shell = new core.Shell({ fs, limits: { maxOutputBytes: 2 } }).use(optional.yqCommands());
    await assert.rejects(owner.shell.exec("yq -i '.a = 2' /settings.yaml"), error => error instanceof core.ShellLimitError && error.limit === "maxOutputBytes");
    assert.deepEqual(await fs.readFile("/settings.yaml"), new Uint8Array(original));
    assert.deepEqual(await fs.readdir("/"), [{ name: "settings.yaml", type: "file" }]);
  } finally { await owner.shell?.dispose(); }
}

for (const pipefail of [false, true]) {
  const owner = {};
  const devices = optional.createDeviceFileSystem();
  const descriptors = [];
  const open = devices.open.bind(devices);
  devices.open = async (...args) => {
    const descriptor = await open(...args);
    const entry = { closes: 0 };
    descriptors.push(entry);
    const close = descriptor.close.bind(descriptor);
    descriptor.close = async () => { entry.closes++; await close(); };
    return descriptor;
  };
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dev": devices } });
  try {
    owner.shell = new core.Shell({ fs, limits: { maxWallClockMs: 2000 } }).use(core.agentCommands());
    await fs.writeFile("/device.sh", Buffer.from(`${pipefail ? "set -o pipefail; " : ""}cat </dev/zero | head -c32`));
    const result = await owner.shell.exec("bash /device.sh");
    assert.equal(result.exitCode, pipefail ? 141 : 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, new Uint8Array(32));
    assert.ok(descriptors.length > 0);
    assert.ok(descriptors.every(entry => entry.closes === 1));
  } finally { await owner.shell?.dispose(); }
}

{
  const owner = {};
  const fs = createMemoryFileSystem();
  try {
    owner.shell = new core.Shell({ fs, extensions: extensionNames.map(name => optional[name]()) }).use(core.agentCommands());
    const source = [
      "values=(left ''); printf '<%s><%s>;' \"${values[1]-fallback}\" \"${values[1]+present}\"",
      "read -r -d '' -a raw; printf '%s' \"${raw[@]}\"",
      "mapfile -d '' -t rows; printf '%s' \"${rows[@]}\"",
      String.raw`action=$'printf "\375"'; trap "$action" EXIT`,
      '{ exit 7; } & child=$!; wait "$child"; printf ":%s" "$?"',
    ].join("\n");
    await fs.writeFile("/optional.sh", Buffer.from(source));
    const result = await owner.shell.exec("bash /optional.sh", { stdin: Uint8Array.of(255, 32, 254, 0, 195, 169, 0) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, Uint8Array.from([...Buffer.from("<><present>;"), 255, 254, 195, 169, ...Buffer.from(":7"), 253]));
  } finally { await owner.shell?.dispose(); }
}

function deferred() {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
}

for (const wait of ['wait "$child"', 'wait -n -p chosen "$child"']) {
  const owner = {};
  const released = deferred();
  const blocked = deferred();
  const admitted = deferred();
  const controller = new AbortController();
  const descriptors = [];
  const subscriptions = [];
  const events = [];
  let childReturns = 0;
  let observed;
  let timedRelease = false;
  try {
    const memory = createMemoryFileSystem();
    await memory.writeFile("/gate", Buffer.from("release\n"));
    const fs = new Proxy(memory, { get(target, property) {
      if (property === "open") return async (...args) => {
        const descriptor = await target.open(...args);
        const entry = { closes: 0 };
        descriptors.push(entry);
        return new Proxy(descriptor, { get(resource, member) {
          if (member === "close") return async () => { entry.closes++; await resource.close(); };
          if (member === "read" && args[0] === "/gate") return async (...operation) => {
            blocked.resolve();
            const signal = operation[2]?.signal;
            let abort;
            try {
              await new Promise((resolveRead, reject) => {
                abort = () => reject(signal?.reason);
                if (signal?.aborted) abort();
                else signal?.addEventListener("abort", abort, { once: true });
                void released.promise.then(resolveRead);
              });
              signal?.throwIfAborted();
              return await resource.read(...operation);
            } finally { signal?.removeEventListener("abort", abort); }
          };
          const value = Reflect.get(resource, member, resource);
          return typeof value === "function" ? value.bind(resource) : value;
        } });
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const jobs = optional.jobsExtension();
    const observedJobs = { ...jobs, create() {
      const instance = jobs.create();
      return { ...instance, builtins: instance.builtins.map(builtin => builtin.name !== "wait" ? builtin : { ...builtin, execute(context) {
        const bridge = context.waitInterruptibly;
        assert.equal(typeof bridge, "function");
        const instrumented = new Proxy(context, { get(target, property, receiver) {
          if (property === "waitInterruptibly") return operation => bridge(signal => {
            const previous = Object.getOwnPropertyDescriptor(signal, "addEventListener");
            const add = signal.addEventListener;
            Object.defineProperty(signal, "addEventListener", { configurable: true, value(type, listener, options) {
              add.call(signal, type, listener, options);
              if (type === "abort") { events.push("admitted"); admitted.resolve(); }
            } });
            try { return operation(signal); }
            finally {
              if (previous) Object.defineProperty(signal, "addEventListener", previous);
              else Reflect.deleteProperty(signal, "addEventListener");
            }
          });
          return Reflect.get(target, property, receiver);
        } });
        return builtin.execute(instrumented);
      } }) };
    } };
    owner.shell = new core.Shell({ fs, extensions: [observedJobs, optional.trapExtension({ signalNames: { SIGUSR1: 30 }, signalHost: {
      subscribe(deliver) { const entry = { deliver, closes: 0 }; subscriptions.push(entry); return () => { entry.closes++; }; },
    } })] }).use(core.agentCommands());
    owner.shell.register({ name: "child_read", async execute({ stdin, signal }) {
      for await (const bytes of stdin) { assert.ok(bytes.length > 0); signal.throwIfAborted(); }
      childReturns++;
      events.push("child-returned");
      return { exitCode: 7 };
    } });
    owner.shell.register({ name: "parent_observe", execute({ args }) {
      observed = { status: Number(args[0]), traps: Number(args[1]), chosen: args[2], trapStatus: Number(args[3]), childLive: childReturns === 0 };
      events.push("parent-continued");
      clearTimeout(owner.negative);
      released.resolve();
      return { exitCode: 0 };
    } });
    owner.safety = setTimeout(() => { controller.abort(new Error("installed wait safety deadline")); released.resolve(); }, 2000);
    owner.running = owner.shell.exec(`traps=0; chosen=old; trap 'trap_status=$?; traps=$((traps + 1))' USR1; child_read </gate & child=$!; ${wait}; first=$?; parent_observe "$first" "$traps" "\${chosen-unset}" "$trap_status"; wait "$child"; printf 'later:%s\n' "$?"`, { signal: controller.signal });
    void owner.running.catch(() => undefined);
    await Promise.race([Promise.all([blocked.promise, admitted.promise]), owner.running.then(() => assert.fail("ended before actual wait admission"))]);
    events.push("delivered");
    assert.equal(subscriptions[0].deliver("USR1"), true);
    owner.negative = setTimeout(() => { timedRelease = true; released.resolve(); }, 150);
    const result = await owner.running;
    clearTimeout(owner.safety);
    clearTimeout(owner.negative);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "later:7\n");
    assert.deepEqual(observed, { status: 158, traps: 1, chosen: wait.includes("-p") ? "unset" : "old", trapStatus: 158, childLive: true });
    assert.equal(childReturns, 1);
    assert.equal(timedRelease, false);
    assert.ok(events.indexOf("admitted") < events.indexOf("delivered"));
    assert.ok(events.indexOf("parent-continued") < events.indexOf("child-returned"));
    assert.ok(descriptors.length > 0 && descriptors.every(entry => entry.closes === 1));
    assert.ok(subscriptions.length > 0 && subscriptions.every(entry => entry.closes === 1));
    assert.equal(subscriptions[0].deliver("USR1"), false);
  } finally {
    clearTimeout(owner.safety);
    clearTimeout(owner.negative);
    controller.abort(new Error("installed wait cleanup"));
    released.resolve();
    await owner.running?.catch(() => undefined);
    await owner.shell?.dispose();
  }
}

{
  const owner = {};
  const entered = deferred();
  const released = deferred();
  const controller = new AbortController();
  let active = 0;
  let settled = false;
  try {
    const memory = createMemoryFileSystem();
    await memory.writeFile("/source", Uint8Array.of(255, 0, 195, 169));
    const fs = new Proxy(memory, { get(target, property) {
      if (property === "writeStream") return undefined;
      if (property === "writeFile") return async (...args) => {
        active++;
        entered.resolve();
        try { await released.promise; await target.writeFile(...args); }
        finally { active--; }
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    owner.shell = new core.Shell({ fs }).use(optional.installCommands());
    owner.safety = setTimeout(() => { controller.abort(new Error("installed writer safety deadline")); released.resolve(); }, 2000);
    owner.running = owner.shell.exec("install /source /target", { signal: controller.signal });
    const checked = assert.rejects(owner.running, error => error === false);
    void checked.catch(() => undefined);
    void owner.running.then(() => { settled = true; }, () => { settled = true; });
    await Promise.race([entered.promise, owner.running.then(() => assert.fail("ended before writer admission"))]);
    controller.abort(false);
    await new Promise(resolveTurn => setImmediate(resolveTurn));
    assert.equal(settled, false);
    assert.equal(active, 1);
    released.resolve();
    await checked;
    assert.equal(active, 0);
  } finally {
    clearTimeout(owner.safety);
    controller.abort(new Error("installed writer cleanup"));
    released.resolve();
    await owner.running?.catch(() => undefined);
    await owner.shell?.dispose();
  }
}

for (const scenario of [{ reason: undefined }, { reason: null }, { reason: false }, { reason: 0 }, { reason: "" }, { reason: false, cancel: true }]) {
  const owner = {};
  const controller = new AbortController();
  const subscriptions = [];
  let output = "";
  try {
    owner.shell = new core.Shell({ fs: createMemoryFileSystem(), extensions: [optional.trapExtension({ signalNames: { SIGUSR1: 30 }, signalHost: {
      subscribe(deliver) { const entry = { deliver, closes: 0 }; subscriptions.push(entry); return () => { entry.closes++; throw new Error("secondary subscription cleanup"); }; },
    } }), { name: "installed-host-failure", create: () => ({ builtins: [], checkpoint(point) {
      if (point === "loop-body-complete") {
        if (scenario.cancel) controller.abort(0);
        throw scenario.reason;
      }
    } }) }] }).use(core.agentCommands());
    owner.shell.register({ name: "deliver", execute() { assert.equal(subscriptions[0].deliver("USR1"), true); return { exitCode: 0 }; } });
    const result = await owner.shell.exec("trap 'for item in only; do :; done; printf forbidden' USR1; deliver; printf forbidden", {
      signal: controller.signal,
      stdout: { async write(bytes) { output += Buffer.from(bytes).toString(); } },
    }).then(value => ({ kind: "return", value }), error => ({ kind: "throw", error }));
    assert.equal(result.kind, "throw");
    assert.equal(result.error, scenario.cancel ? 0 : scenario.reason);
    assert.equal(output, "");
    assert.ok(subscriptions.length > 0 && subscriptions.every(entry => entry.closes === 1));
    assert.equal(subscriptions[0].deliver("USR1"), false);
  } finally { await owner.shell?.dispose().catch(() => undefined); }
}

for (const scenario of [
  { name: "limit9 preserves the source and removes staging", limit: 9, published: false, fails: true, suffix: "" },
  { name: "limit10 admits both writes and removes staging", limit: 10, published: true, fails: false, suffix: "" },
  { name: "limit10 charges both writes against later stdout", limit: 10, published: true, fails: true, suffix: "; review-stdout" },
]) {
  const owner = {};
  try {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input.yaml", Buffer.from("a: 1\n"), { mode: 0o640 });
    const before = await fs.stat("/input.yaml");
    const write = fs.writeFile.bind(fs);
    const remove = fs.rm.bind(fs);
    const writes = [];
    const completedWrites = [];
    const renames = [];
    const removals = [];
    const events = [];
    fs.writeFile = async (path, bytes, options) => {
      events.push(`write:${options?.flag}`);
      writes.push({ path, flag: options?.flag, bytes: Uint8Array.from(bytes) });
      await write(path, bytes, options);
      completedWrites.push(path);
    };
    fs.rename = async (source, destination) => {
      events.push("rename");
      renames.push({ source, destination });
      throw new FsError("EXDEV");
    };
    fs.rm = async (path, options) => {
      events.push("remove");
      await remove(path, options);
      removals.push(path);
    };
    const shell = owner.shell = new core.Shell({ fs, limits: { maxOutputBytes: scenario.limit } }).use(optional.yqCommands());
    shell.register({
      name: "review-stdout", runtimeIdentity: core.commandRuntimeIdentity,
      async execute({ stdout }) {
        events.push("stdout");
        await stdout.write(Buffer.from("x"));
        return { exitCode: 0 };
      },
    });
    const execution = shell.exec("yq -i '.a = 2' /input.yaml" + scenario.suffix);
    if (scenario.fails) {
      await assert.rejects(execution, error => error instanceof core.ShellLimitError && error.limit === "maxOutputBytes", scenario.name);
    } else {
      const result = await execution;
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    }
    const after = await fs.stat("/input.yaml");
    assert.deepEqual({
      bytes: await fs.readFile("/input.yaml"), mode: after.mode & 0o7777,
      retainedIdentity: after.ino === before.ino, entries: await fs.readdir("/"),
    }, {
      bytes: new Uint8Array(Buffer.from(scenario.published ? "a: 2\n" : "a: 1\n")), mode: 0o640,
      retainedIdentity: true, entries: [{ name: "input.yaml", type: "file" }],
    });
    const staging = writes[0]?.path;
    assert.ok(staging);
    assert.ok(staging.startsWith("/.yq-"));
    const expectedWrites = [
      { path: staging, flag: "wx", bytes: new Uint8Array(Buffer.from("a: 2\n")) },
      ...(scenario.published ? [{ path: "/input.yaml", flag: "w", bytes: new Uint8Array(Buffer.from("a: 2\n")) }] : []),
    ];
    assert.deepEqual(writes, expectedWrites);
    assert.deepEqual(completedWrites, scenario.published ? [staging, "/input.yaml"] : [staging]);
    assert.deepEqual(renames, [{ source: staging, destination: "/input.yaml" }]);
    assert.deepEqual(removals, [staging]);
    assert.deepEqual(events, ["write:wx", "rename", ...(scenario.published ? ["write:w"] : []), "remove", ...(scenario.suffix ? ["stdout"] : [])]);
    await shell.dispose();
    assert.deepEqual(removals, [staging]);
  } finally { await owner.shell?.dispose(); }
}

for (const output of ["stream", "buffered"]) for (const scenario of [
  { route: "scoped", action: "abort" },
  { route: "Shell", action: "abort" },
  { route: "Shell", action: "budget" },
  { route: "Shell", action: "success" },
]) {
  const owner = {};
  const cleanups = [];
  try {
    const base = createMemoryFileSystem();
    const bytes = Uint8Array.of(0, 255, 128, 65, 10);
    await base.writeFile("/source", bytes, { mode: 0o640 });
    const before = await base.stat("/source");
    const capabilities = { ...base.capabilities, streamingWrite: output === "stream" };
    const writes = [];
    const completedWrites = [];
    const removals = [];
    const fs = new Proxy(base, { get(target, key) {
      if (key === "capabilities") return capabilities;
      if (key === "writeStream") return output === "buffered" ? undefined : async (...args) => {
        assert.equal(args[0], "/target");
        assert.equal(args[2]?.flag, "wx");
        writes.push("stream");
        await target.writeStream(...args);
        completedWrites.push("stream");
      };
      if (key === "writeFile") return async (...args) => {
        assert.equal(args[0], "/target");
        assert.equal(args[2]?.flag, "wx");
        assert.deepEqual(args[1], bytes);
        writes.push("buffered");
        await target.writeFile(...args);
        completedWrites.push("buffered");
      };
      if (key === "rm") return async (...args) => {
        assert.equal(args[0], "/target");
        await target.rm(...args);
        removals.push(args[0]);
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const controller = new AbortController();
    let stripCalls = 0;
    let stripSignal;
    const command = optional.createInstallCommand({
      identity: { uid: 0, gid: 0 }, securityContext: { enabled: false },
      async strip(path, program, commandContext) {
        stripCalls++;
        stripSignal = commandContext.signal;
        assert.equal(path, "/target");
        assert.equal(program, "strip");
        assert.deepEqual(await base.readFile(path), bytes);
        assert.deepEqual(completedWrites, [output]);
        if (scenario.action === "abort") {
          controller.abort(false);
          throw new FsError("ENOENT");
        }
        if (scenario.action === "budget") await commandContext.stdout.write(Uint8Array.of(120));
        return 0;
      },
    });
    assert.equal(command.runtimeIdentity, core.commandRuntimeIdentity);
    const shell = scenario.route === "Shell"
      ? owner.shell = new core.Shell({ fs, ...(scenario.action === "budget" ? { limits: { maxOutputBytes: 5 } } : {}) })
      : undefined;
    shell?.register(command);
    const execution = shell
      ? shell.exec("install -s /source /target", { signal: controller.signal })
      : Promise.resolve(command.execute({
        command: "install", args: ["-s", "/source", "/target"], cwd: "/", env: {},
        fs: scopeFileSystem(fs, () => {}, controller.signal), signal: controller.signal,
        stdin: core.toByteSource(new Uint8Array()),
        stdout: { async write() { assert.fail("unexpected standalone stdout"); } },
        stderr: { async write() { assert.fail("unexpected standalone stderr"); } },
        registerCleanup(cleanup) { cleanups.push(cleanup); },
      }));
    if (scenario.action === "abort") {
      await assert.rejects(execution, reason => reason === false && reason === controller.signal.reason);
    } else if (scenario.action === "budget") {
      await assert.rejects(execution, reason => reason instanceof core.ShellLimitError && reason.limit === "maxOutputBytes" && reason === stripSignal?.reason);
    } else {
      const result = await execution;
      assert.equal(result.exitCode, 0);
      assert.ok("stdout" in result);
      assert.ok("stderr" in result);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    }
    assert.equal(stripCalls, 1);
    assert.deepEqual(writes, [output]);
    assert.deepEqual(completedWrites, [output]);
    const after = await base.stat("/source");
    assert.deepEqual({ bytes: await base.readFile("/source"), mode: after.mode & 0o7777, retainedIdentity: after.ino === before.ino }, {
      bytes, mode: 0o640, retainedIdentity: true,
    });
    if (scenario.action === "success") {
      assert.deepEqual(await base.readFile("/target"), bytes);
      assert.equal((await base.stat("/target")).mode & 0o7777, 0o755);
      assert.deepEqual(removals, []);
      assert.deepEqual((await base.readdir("/")).map(entry => entry.name), ["source", "target"]);
    } else {
      await assert.rejects(base.stat("/target"), error => error instanceof FsError && error.code === "ENOENT");
      assert.deepEqual(removals, ["/target"]);
      assert.deepEqual((await base.readdir("/")).map(entry => entry.name), ["source"]);
    }
    await shell?.dispose();
    await Promise.allSettled(cleanups.map(cleanup => Promise.resolve().then(cleanup)));
    assert.deepEqual(removals, scenario.action === "success" ? [] : ["/target"]);
  } finally {
    try { await owner.shell?.dispose(); }
    finally { await Promise.allSettled(cleanups.map(cleanup => Promise.resolve().then(cleanup))); }
  }
}

console.log(JSON.stringify({ profile: "installed-optional", tools: factories.map(([name]) => name), extensions: extensionNames, yaml: installedYaml.manifest.version, canonicalCore: installedCore.entry, canonicalFs: installedFs.entry, separateCore: foreignCoreArtifact.entry, status: "passed" }));
