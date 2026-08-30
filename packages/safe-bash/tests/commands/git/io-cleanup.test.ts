import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { type CommandContext, type FileSystem, type InvocationCleanup } from "../../../src/contracts/index.js";
import { createGitCommand } from "../../../src/commands/git/index.js";
import { Session } from "../../../src/commands/git/io.js";
import { ConsumerClosed, GIT_LIMITS, GitFailure } from "../../../src/commands/git/limits.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";

const reasons: readonly unknown[] = [undefined, null, false, 0, "", NaN, { failure: "identity" }];
const methods = ["read", "visitFile"] as const;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

async function rejectsWith(pending: Promise<unknown>, expected: unknown): Promise<void> {
  let rejected = false;
  await pending.then(() => {}, reason => {
    rejected = true;
    assert.ok(Object.is(reason, expected), "rejection identity must match, including falsey reasons");
  });
  assert.equal(rejected, true, "operation must reject");
}

function stream(bytes: Uint8Array, close: () => Promise<void> = async () => {}): AsyncIterator<Uint8Array> {
  let yielded = false;
  return {
    async next() {
      if (yielded || bytes.length === 0) return { done: true, value: undefined };
      yielded = true;
      return { done: false, value: bytes };
    },
    async return() { await close(); return { done: true, value: undefined }; },
  };
}

async function fixture(context: TestContext, iterator?: AsyncIterator<Uint8Array>, controller = new AbortController()) {
  const base = createMemoryFileSystem();
  await base.writeFile("/input", Buffer.from("ab"));
  await base.mkdir("/.git/objects", { recursive: true });
  await base.writeFile("/.git/HEAD", Buffer.from("ref: refs/heads/main\n"));
  await base.writeFile("/.git/config", Buffer.alloc(0));
  const state = { opens: 0, next: 0, returns: 0 };
  const cleanups: InvocationCleanup[] = [];
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  const fs: FileSystem = new Proxy(base, { get(target, key) {
    if (key === "readStream" && iterator) return (path: string, options: Parameters<NonNullable<FileSystem["readStream"]>>[1]) => {
      if (path !== "/input" && path !== "/.git/config") return target.readStream!(path, options);
      assert.equal(options?.chunkSize, GIT_LIMITS.maxChunkBytes);
      state.opens++;
      return { [Symbol.asyncIterator]() { return {
        next() { state.next++; return iterator.next(); },
        async return() { state.returns++; return await iterator.return?.() ?? { done: true, value: undefined }; },
      }; } };
    };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const command: CommandContext = {
    command: "git", args: ["rev-parse", "--absolute-git-dir"], cwd: "/", env: {}, fs,
    signal: controller.signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
    registerCleanup(cleanup) { cleanups.push(cleanup); },
  };
  context.after(async () => { for (const cleanup of cleanups) await Promise.resolve().then(cleanup).catch(() => {}); });
  return { base, command, state, stdout, stderr };
}

function read(session: Session, method: typeof methods[number]): Promise<unknown> {
  return method === "read" ? session.read("/input", 4) : session.visitFile("/input", 4, async () => {});
}

for (const method of methods) {
  test(`Session.${method}: every falsey primary beats every cleanup reason`, { timeout: 2000 }, async context => {
    for (const primary of reasons) for (const cleanup of reasons) {
      const current = await fixture(context, {
        async next() { throw primary; },
        async return() { throw cleanup; },
      });
      const session = new Session(current.command, "/");
      await rejectsWith(read(session, method), primary);
      await rejectsWith(session.operation.close(), cleanup);
      assert.equal(current.state.returns, 1);
    }
  });

  test(`Session.${method}: cleanup-only falsey rejection propagates after EOF`, { timeout: 2000 }, async context => {
    for (const cleanup of reasons) {
      const current = await fixture(context, stream(Buffer.from("ab"), async () => { throw cleanup; }));
      const session = new Session(current.command, "/");
      await rejectsWith(read(session, method), cleanup);
      await rejectsWith(session.operation.close(), cleanup);
      assert.equal(current.state.next, 2);
      assert.equal(current.state.returns, 1);
    }
  });

  for (const bodyFails of [false, true]) for (const closeFails of [false, true]) {
    test(`Session.${method}: awaited shared close; bodyFails=${bodyFails}, closeFails=${closeFails}`, { timeout: 2000 }, async context => {
      const entered = deferred(), release = deferred();
      context.after(release.resolve);
      const primary = { primary: true }, cleanup = { cleanup: true };
      const iterator = stream(Buffer.from("ab"), async () => {
        entered.resolve(); await release.promise;
        if (closeFails) throw cleanup;
      });
      if (bodyFails) iterator.next = async () => { throw primary; };
      const current = await fixture(context, iterator);
      const session = new Session(current.command, "/");
      const pending = read(session, method);
      let settled = false;
      const observed = pending.then(() => { settled = true; }, () => { settled = true; });
      await entered.promise;
      const first = session.operation.close(), second = session.operation.close();
      assert.equal(first, second);
      const closing = first.then(() => {}, () => {});
      try {
        await setImmediate();
        assert.equal(settled, false);
        assert.equal(current.state.returns, 1);
      } finally { release.resolve(); }
      if (bodyFails || closeFails) await rejectsWith(pending, bodyFails ? primary : cleanup);
      else {
        const result = await pending;
        if (method === "read") { assert.deepEqual(result, Buffer.from("ab")); session.release(result as Buffer); }
      }
      await observed; await closing;
      if (closeFails) await rejectsWith(first, cleanup);
      else await first;
      assert.equal(current.state.returns, 1);
    });
  }

  test(`Session.${method}: changed identity and admission bounds retain cleanup`, { timeout: 2000 }, async context => {
    let changed = false;
    const iterator = stream(Buffer.from("ab"));
    const next = iterator.next.bind(iterator);
    iterator.next = async () => { const row = await next(); if (row.done) changed = true; return row; };
    const current = await fixture(context, iterator);
    const lstat = current.command.fs.lstat.bind(current.command.fs);
    const fs: FileSystem = new Proxy(current.command.fs, { get(target, key) {
      if (key === "lstat") return async (...args: Parameters<FileSystem["lstat"]>) => {
        const stat = await lstat(...args);
        return args[0] === "/input" && changed ? { ...stat, mtimeMs: stat.mtimeMs + 1 } : stat;
      };
      return Reflect.get(target, key);
    } });
    const session = new Session({ ...current.command, fs }, "/");
    await assert.rejects(read(session, method), error => error instanceof GitFailure && error.message.includes("changed"));
    assert.equal(current.state.returns, 1);
    await session.operation.close();
    const bounded = new Session(current.command, "/");
    await assert.rejects(method === "read" ? bounded.read("/input", 1) : bounded.visitFile("/input", 1, async () => {}), GitFailure);
    assert.equal(current.state.opens, 1);
  });
}

test("Session.read: copied fragments release before close and preserve byte budgets", { timeout: 2000 }, async context => {
  const buffer = Buffer.from("ab");
  let step = 0;
  const current = await fixture(context, {
    async next() {
      if (step++ === 0) return { done: false, value: buffer };
      if (step === 2) { buffer.set(Buffer.from("cd")); return { done: false, value: buffer }; }
      return { done: true, value: undefined };
    },
    async return() {
      buffer.fill(0);
      session.reserve(GIT_LIMITS.maxResidentBytes - 4);
      session.unreserve(GIT_LIMITS.maxResidentBytes - 4);
      return { done: true, value: undefined };
    },
  });
  await current.base.writeFile("/input", Buffer.from("abcd"));
  const session = new Session(current.command, "/");
  const result = await session.read("/input", 4);
  assert.deepEqual(result, Buffer.from("abcd"));
  session.release(result!);
  session.reserve(GIT_LIMITS.maxResidentBytes); session.unreserve(GIT_LIMITS.maxResidentBytes);
  session.charge("maxReadBytes", GIT_LIMITS.maxReadBytes - 4);
  assert.throws(() => session.charge("maxReadBytes", 1), GitFailure);
  session.charge("maxChunks", GIT_LIMITS.maxChunks - 2);
  assert.throws(() => session.charge("maxChunks", 1), GitFailure);
  await session.operation.close();
  assert.equal(current.state.returns, 1);
});

test("Session.read: failed reads release prior fragments before rejecting close", { timeout: 2000 }, async context => {
  let yielded = false;
  const primary = { primary: true }, cleanup = { cleanup: true };
  const current = await fixture(context, {
    async next() { if (yielded) throw primary; yielded = true; return { done: false, value: Buffer.from("ab") }; },
    async return() { session.reserve(GIT_LIMITS.maxResidentBytes); session.unreserve(GIT_LIMITS.maxResidentBytes); throw cleanup; },
  });
  const session = new Session(current.command, "/");
  await rejectsWith(session.read("/input", 4), primary);
  await rejectsWith(session.operation.close(), cleanup);
  assert.equal(current.state.returns, 1);
});

test("Session.visitFile: consumer failure preserves identity and closes early", { timeout: 2000 }, async context => {
  for (const primary of reasons) {
    const cleanup = { cleanup: true };
    const current = await fixture(context, stream(Buffer.from("ab"), async () => { throw cleanup; }));
    const session = new Session(current.command, "/");
    await rejectsWith(session.visitFile("/input", 4, async (bytes, offset) => {
      assert.deepEqual(bytes, Buffer.from("ab")); assert.equal(offset, 0); throw primary;
    }), primary);
    assert.equal(current.state.next, 1);
    assert.equal(current.state.returns, 1);
  }
});

test("public Git: raw falsey primary beats cleanup independently", { timeout: 2000 }, async context => {
  for (const primary of reasons) for (const cleanup of reasons) {
    const current = await fixture(context, { async next() { throw primary; }, async return() { throw cleanup; } });
    await rejectsWith(Promise.resolve(createGitCommand().execute(current.command)), primary);
    assert.equal(current.state.returns, 1);
    assert.deepEqual(current.stderr, []);
  }
});

test("public Git: cleanup outranks handled diagnostics and ConsumerClosed", { timeout: 2000 }, async context => {
  for (const primary of [new GitFailure("handled"), new ConsumerClosed("closed")]) for (const cleanup of reasons) {
    const current = await fixture(context, { async next() { throw primary; }, async return() { throw cleanup; } });
    await rejectsWith(Promise.resolve(createGitCommand().execute(current.command)), cleanup);
    assert.equal(current.state.returns, 1);
    assert.deepEqual(current.stderr, []);
  }
});

test("public Git: handled outcomes remain diagnostics without cleanup failure", { timeout: 2000 }, async context => {
  for (const primary of [new GitFailure("handled"), new ConsumerClosed("closed")]) {
    const current = await fixture(context, { async next() { throw primary; }, async return() { return { done: true, value: undefined }; } });
    const result = await createGitCommand().execute(current.command);
    assert.equal(result.exitCode, primary instanceof GitFailure ? 128 : 141);
    assert.equal(Buffer.concat(current.stderr).toString(), primary instanceof GitFailure ? "git: handled\n" : "");
    assert.equal(current.state.returns, 1);
  }
});

test("public Git: cleanup-only falsey failures remain failures", { timeout: 2000 }, async context => {
  for (const cleanup of reasons) {
    const current = await fixture(context, stream(Buffer.alloc(0), async () => { throw cleanup; }));
    await rejectsWith(Promise.resolve(createGitCommand().execute(current.command)), cleanup);
    assert.equal(current.state.returns, 1);
  }
});

for (const [index, reason] of reasons.entries()) {
  test(`public Git: cancellation at cleanup settlement wins; reason=${index}`, { timeout: 2000 }, async context => {
    const entered = deferred(), release = deferred();
    context.after(release.resolve);
    const controller = new AbortController();
    const current = await fixture(context, {
      async next() { throw new Error("raw primary"); },
      async return() { entered.resolve(); await release.promise; throw new Error("cleanup"); },
    }, controller);
    const pending = Promise.resolve(createGitCommand().execute(current.command));
    let settled = false;
    const observed = pending.then(() => { settled = true; }, () => { settled = true; });
    await entered.promise;
    try {
      controller.abort(reason);
      await setImmediate();
      assert.equal(settled, false);
    } finally { release.resolve(); }
    await rejectsWith(pending, controller.signal.reason);
    await observed;
    assert.equal(current.state.returns, 1);
  });
}

test("public Git: bounded MemoryFS empty pack uses exact reads and EOF returns", { timeout: 2000 }, async context => {
  const current = await fixture(context);
  const header = Buffer.from("5041434b0000000200000000", "hex");
  const checksum = createHash("sha1").update(header).digest();
  const pack = Buffer.concat([header, checksum]);
  const indexBody = Buffer.alloc(1052);
  Buffer.from("ff744f6300000002", "hex").copy(indexBody);
  checksum.copy(indexBody, 1032);
  const index = Buffer.concat([indexBody, createHash("sha1").update(indexBody).digest()]);
  const prefix = `/.git/objects/pack/pack-${checksum.toString("hex")}`;
  await current.base.mkdir("/.git/objects/pack");
  await current.base.writeFile(prefix + ".pack", pack);
  await current.base.writeFile(prefix + ".idx", index);
  const reads: { path: string; bytes: number; eof: boolean; returns: number }[] = [];
  const fs: FileSystem = new Proxy(current.command.fs, { get(target, key) {
    if (key === "readStream") return (path: string, options: Parameters<NonNullable<FileSystem["readStream"]>>[1]) => {
      if (!path.startsWith(prefix)) return target.readStream!(path, options);
      assert.equal(options?.chunkSize, GIT_LIMITS.maxChunkBytes);
      const state = { path, bytes: 0, eof: false, returns: 0 };
      reads.push(state);
      const iterator = target.readStream!(path, { ...options, chunkSize: 7 })[Symbol.asyncIterator]();
      return { [Symbol.asyncIterator]() { return {
        async next() { const row = await iterator.next(); if (row.done) state.eof = true; else { assert.ok(row.value.length <= 7); state.bytes += row.value.length; } return row; },
        async return() { state.returns++; return await iterator.return?.() ?? { done: true, value: undefined }; },
      }; } };
    };
    return Reflect.get(target, key);
  } });
  assert.deepEqual(await createGitCommand().execute({ ...current.command, fs }), { exitCode: 0 });
  assert.equal(Buffer.concat(current.stdout).toString(), "/.git\n");
  assert.deepEqual(current.stderr, []);
  assert.equal(reads.length, 4);
  for (const read of reads) {
    assert.equal(read.eof, true); assert.equal(read.returns, 1);
    assert.equal(read.bytes, read.path.endsWith(".pack") ? 32 : 1072);
  }
});
