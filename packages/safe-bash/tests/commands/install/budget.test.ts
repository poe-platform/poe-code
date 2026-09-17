import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, FsError, withFileSystemQuota } from "poe-code/safe-fs";
import type { FileSystem, InvocationCleanup } from "../../../src/contracts/index.js";
import { commandRuntimeIdentity } from "../../../src/contracts/command.js";
import { installCommands } from "../../../src/commands/install/index.js";
import { Shell, ShellLimitError } from "../../../src/shell/index.js";
import { run, wrapped } from "./helpers.js";

const content = Uint8Array.of(0, 255, 128, 65);
const profileOptions = { identity: { uid: 0, gid: 0 }, securityContext: { enabled: false } };

async function fixture(profile: "memory" | "stream-only" | "buffered") {
  const backing = createMemoryFileSystem();
  await backing.writeFile("/source", content, { mode: 0o640 });
  await backing.utimes("/source", 1000, 2000);
  const requests: { flag: string | undefined; mode: number | undefined }[] = [];
  const state = { sourceClosed: 0, activeWriters: 0, fileWrites: 0 };
  const filesystem = wrapped(backing, {
    capabilities: { ...backing.capabilities, ...(profile === "buffered" ? { streamingWrite: false } : {}), ...(profile === "stream-only" ? { open: false, append: false } : {}) },
    open: profile === "stream-only" ? undefined : async (path, options) => {
      const descriptor = await backing.open(path, options), close = descriptor.close.bind(descriptor);
      descriptor.close = async () => { if (path === "/source") state.sourceClosed++; await close(); };
      return descriptor;
    },
    async *readStream(path, options) {
      try { yield* backing.readStream(path, options); }
      finally { if (path === "/source") state.sourceClosed++; }
    },
    writeStream: profile === "buffered" ? undefined : async (path, source, options) => {
      requests.push({ flag: options?.flag, mode: options?.mode });
      state.activeWriters++;
      try { await backing.writeStream(path, source, options); }
      finally { state.activeWriters--; }
    },
    async writeFile(path, data, options) {
      state.fileWrites++;
      assert.notEqual(profile, "stream-only", "stream-only provider must not acquire a writeFile fallback");
      requests.push({ flag: options?.flag, mode: options?.mode });
      await backing.writeFile(path, data, options);
    },
    appendFile: profile === "stream-only" ? async () => { throw new FsError("ENOTSUP"); } : backing.appendFile.bind(backing),
  });
  return { backing, filesystem, requests, state };
}

async function optionalBytes(filesystem: FileSystem, path: string): Promise<Uint8Array> {
  try { return await filesystem.readFile(path); }
  catch (error) { if (error instanceof FsError && error.code === "ENOENT") return new Uint8Array(); throw error; }
}

for (const profile of ["memory", "stream-only", "buffered"] as const) {
  test(`install enforces actual Shell named-file output limits for ${profile}`, async () => {
    const { backing, filesystem, state } = await fixture(profile);
    const shell = new Shell({ fs: filesystem, limits: { maxOutputBytes: 2 } }).use(installCommands(profileOptions));
    try {
      await assert.rejects(shell.exec("install /source /target"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
      assert.ok((await optionalBytes(backing, "/target")).length <= 2);
      assert.equal(state.sourceClosed, 1);
      assert.equal(state.activeWriters, 0);
      if (profile === "buffered") assert.equal(state.fileWrites, 0);
    } finally { await shell.dispose(); }
  });

  test(`install charges exactly once and preserves wx/0600 creation for ${profile}`, async () => {
    const { backing, filesystem, requests, state } = await fixture(profile);
    const shell = new Shell({ fs: filesystem, limits: { maxOutputBytes: 4 } }).use(installCommands(profileOptions));
    try {
      const result = await shell.exec("install -p /source /target");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      const metadata = await backing.stat("/target");
      assert.equal(metadata.mode & 0o7777, 0o755);
      assert.equal(metadata.atimeMs, 1000);
      assert.equal(metadata.mtimeMs, 2000);
      assert.deepEqual(await backing.readFile("/target"), content);
      assert.deepEqual(requests, [{ flag: "wx", mode: 0o600 }]);
      assert.equal(state.sourceClosed, 1);
      assert.equal(state.activeWriters, 0);
      if (profile === "stream-only") assert.equal(state.fileWrites, 0);
    } finally { await shell.dispose(); }
  });

  test(`install shares the Shell stdout ledger rather than a per-file allowance for ${profile}`, async () => {
    const { backing, filesystem } = await fixture(profile);
    const shell = new Shell({ fs: filesystem, limits: { maxOutputBytes: 4 } }).use(installCommands(profileOptions));
    shell.use({ name: "install-budget-prefix", setup(host) {
      host.commands.register({ name: "prefix", runtimeIdentity: commandRuntimeIdentity, async execute(context) {
        await context.stdout.write(Uint8Array.of(80));
        return { exitCode: 0 };
      } });
    } });
    try {
      await assert.rejects(shell.exec("prefix; install /source /target"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
      assert.ok((await optionalBytes(backing, "/target")).length <= 3);
    } finally { await shell.dispose(); }
  });

  test(`install creates an empty exclusive target without spending output bytes for ${profile}`, async () => {
    const { backing, filesystem, requests, state } = await fixture(profile);
    await backing.writeFile("/source", new Uint8Array());
    const shell = new Shell({ fs: filesystem, limits: { maxOutputBytes: 1 } }).use(installCommands(profileOptions));
    try {
      const result = await shell.exec("install /source /target");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(await backing.readFile("/target"), new Uint8Array());
      assert.equal((await backing.stat("/target")).mode & 0o7777, 0o755);
      assert.deepEqual(requests, [{ flag: "wx", mode: 0o600 }]);
      assert.equal(state.sourceClosed, 1);
      assert.equal(state.activeWriters, 0);
    } finally { await shell.dispose(); }
  });

  test(`install shares output admission across destination files for ${profile}`, async () => {
    const { backing, filesystem, state } = await fixture(profile);
    await backing.writeFile("/other", content);
    await backing.mkdir("/directory");
    const shell = new Shell({ fs: filesystem, limits: { maxOutputBytes: 6 } }).use(installCommands(profileOptions));
    try {
      await assert.rejects(shell.exec("install /source /other /directory"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
      assert.deepEqual(await backing.readFile("/directory/source"), content);
      assert.equal((await backing.stat("/directory/source")).mode & 0o7777, 0o755);
      if (profile === "buffered") await assert.rejects(backing.stat("/directory/other"), { code: "ENOENT" });
      else {
        assert.deepEqual(await backing.readFile("/directory/other"), new Uint8Array());
        assert.equal((await backing.stat("/directory/other")).mode & 0o7777, 0o600);
      }
      assert.equal(state.activeWriters, 0);
    } finally { await shell.dispose(); }
  });
}

test("stream-only budget rejection retains admitted prefix and mode without leaking either stream", async () => {
  const { backing, filesystem, state } = await fixture("stream-only");
  const host = wrapped(filesystem, { async *readStream() {
    try { yield content.subarray(0, 2); yield content.subarray(2); }
    finally { state.sourceClosed++; }
  } });
  const shell = new Shell({ fs: host, limits: { maxOutputBytes: 3 } }).use(installCommands(profileOptions));
  try {
    await assert.rejects(shell.exec("install /source /target"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.deepEqual(await backing.readFile("/target"), content.subarray(0, 2));
    assert.equal((await backing.stat("/target")).mode & 0o7777, 0o600);
    assert.equal(state.sourceClosed, 1);
    assert.equal(state.activeWriters, 0);
  } finally { await shell.dispose(); }
});

test("quota-backed streaming retains exact committed prefix and preserves exclusive mode", async () => {
  const { backing, filesystem, state } = await fixture("stream-only");
  const source = wrapped(filesystem, { async *readStream() {
    try { yield content.subarray(0, 2); yield content.subarray(2); }
    finally { state.sourceClosed++; }
  } });
  const host = withFileSystemQuota(wrapped(source, { capabilities: { ...source.capabilities, append: true }, writeFile: backing.writeFile.bind(backing), appendFile: backing.appendFile.bind(backing) }), { maxBytes: 6 });
  const result = await run(["/source", "/target"], host);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "install: error writing '/target': No space left on device\n");
  assert.deepEqual(await backing.readFile("/target"), content.subarray(0, 2));
  assert.equal((await backing.stat("/target")).mode & 0o7777, 0o600);
  assert.equal(state.sourceClosed, 1);
});

test("actual Shell cancellation drains the admitted stream-only writer and source", async () => {
  const { backing, filesystem, state } = await fixture("stream-only");
  const controller = new AbortController(), reason = new Error("stop install");
  let entered!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const host = wrapped(filesystem, { async *readStream(_path, options) {
    try {
      yield content.subarray(0, 2);
      await new Promise<never>((_resolve, reject) => {
        const signal = options!.signal!;
        signal.addEventListener("abort", () => { reject(signal.reason); }, { once: true });
        entered();
      });
    } finally { state.sourceClosed++; }
  } });
  const shell = new Shell({ fs: host, limits: { maxOutputBytes: 4 } }).use(installCommands(profileOptions));
  try {
    const execution = shell.exec("install /source /target", { signal: controller.signal });
    const rejected = assert.rejects(execution, error => error === reason);
    await reading;
    controller.abort(reason);
    await rejected;
    assert.deepEqual(await backing.readFile("/target"), content.subarray(0, 2));
    assert.equal((await backing.stat("/target")).mode & 0o7777, 0o600);
    assert.equal(state.sourceClosed, 1);
    assert.equal(state.activeWriters, 0);
  } finally { await shell.dispose(); }
});

test("stream failure after a committed prefix is not replayed through writeFile", async () => {
  const { backing, filesystem, requests, state } = await fixture("stream-only");
  const host = wrapped(filesystem, {
    async *readStream() {
      try { yield content.subarray(0, 2); yield content.subarray(2); }
      finally { state.sourceClosed++; }
    },
    async writeStream(path, source, options) {
      await filesystem.writeStream!(path, (async function* () {
        for await (const bytes of source) { yield bytes; throw new FsError("ENOSPC"); }
      })(), options);
    },
  });
  const result = await run(["/source", "/target"], host);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "install: error writing '/target': No space left on device\n");
  assert.deepEqual(await backing.readFile("/target"), content.subarray(0, 2));
  assert.equal((await backing.stat("/target")).mode & 0o7777, 0o600);
  assert.deepEqual(requests, [{ flag: "wx", mode: 0o600 }]);
  assert.equal(state.sourceClosed, 1);
  assert.equal(state.activeWriters, 0);
  assert.equal(state.fileWrites, 0);
});

for (const registered of [false, true]) {
  test(`standalone buffered cancellation drains the borrowed writer; registered cleanup=${registered}`, async () => {
    const { backing, filesystem, state } = await fixture("buffered");
    const sourceIdentity = (await backing.stat("/source")).ino;
    const controller = new AbortController(), cleanups: InvocationCleanup[] = [];
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let active = false, settled = false, cleanupSettled = false;
    let borrowed: Uint8Array | undefined;
    const host = wrapped(filesystem, { async writeFile(path, data, options) {
      assert.equal(path, "/target");
      assert.equal(options?.flag, "wx");
      assert.equal(options.mode, 0o600);
      active = true;
      borrowed = data;
      entered();
      try {
        await gate;
        assert.deepEqual(data, content);
        await backing.writeFile(path, data, options);
      } finally { active = false; }
    } });
    const execution = run(["/source", "/target"], host, {}, {
      signal: controller.signal,
      ...(registered ? { registerCleanup: (cleanup: InvocationCleanup) => { cleanups.push(cleanup); } } : {}),
    });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    const rejected = assert.rejects(execution, error => error === false);
    let draining: Promise<void> | undefined;
    try {
      await started;
      controller.abort(false);
      if (registered) {
        assert.equal(cleanups.length, 1);
        draining = Promise.allSettled(cleanups.map(cleanup => cleanup())).then(() => { cleanupSettled = true; });
      }
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(active, true);
      assert.equal(settled, false, "direct execute must not settle before its admitted writer");
      assert.deepEqual(borrowed, content);
      if (registered) assert.equal(cleanupSettled, false, "registered cleanup must join the same admitted writer as finally");
    } finally {
      release();
      await rejected;
      await draining;
    }
    assert.equal(active, false);
    assert.equal(state.sourceClosed, 1);
    assert.equal((await backing.stat("/source")).ino, sourceIdentity);
    assert.deepEqual(await backing.readFile("/source"), content);
    await assert.rejects(backing.stat("/target"), { code: "ENOENT" });
  });
}
