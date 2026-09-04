import assert from "node:assert/strict";
import { test } from "node:test";
import { browserCommands } from "../../src/browser.js";
import { FsError, type ByteSource, type FileSystem } from "../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../src/fs/mount/index.js";
import { createReadOnlyFileSystem } from "../../src/fs/readonly/index.js";
import { networkCommands } from "../../src/commands/network/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";

const routes = [
  { name: ">", command: "curl https://example.invalid/body > /out", append: false },
  { name: ">>", command: "curl https://example.invalid/body >> /out", append: true },
  { name: "tee", command: "curl https://example.invalid/body | tee /out", append: false },
  { name: "tee -a", command: "curl https://example.invalid/body | tee -a /out", append: true },
  { name: "curl -o", command: "curl -o /out https://example.invalid/body", append: false },
] as const;
const original = new TextEncoder().encode("original");

function fixture(chunks: readonly Uint8Array[], options: {
  write?: boolean;
  append?: boolean;
  readOnly?: boolean;
  failure?: "before" | "after" | "quota" | "commit";
  failurePath?: string;
  streamingWrite?: boolean;
  streamingAppend?: boolean;
  maxOutputBytes?: number;
  maxWallClockMs?: number;
  body?: (signal: AbortSignal) => ByteSource;
} = {}) {
  const backing = createMemoryFileSystem();
  const state = { streams: 0, mutations: 0, active: 0, produced: 0, disposed: 0 };
  const fs = new Proxy(backing, {
    get(target, key) {
      if (key === "capabilities") return { ...target.capabilities, randomAccessWrite: false, write: options.write, streamingWrite: options.streamingWrite ?? target.capabilities.streamingWrite, streamingAppend: options.streamingAppend, append: options.append, readOnly: options.readOnly };
      if (key === "writeStream") return async (path: string, source: ByteSource, writeOptions: { signal?: AbortSignal; flag?: string } = {}) => {
        state.streams++;
        state.active++;
        try {
          const failure = !options.failurePath || path === options.failurePath ? options.failure : undefined;
          if (failure === "before" || options.append === false && options.streamingAppend !== true && writeOptions.flag === "a") throw new FsError("ENOTSUP");
          const collected: Uint8Array[] = [];
          for await (const chunk of source) {
            collected.push(new Uint8Array(chunk));
            if (failure === "after") throw new FsError("ENOTSUP", { message: "consumed failure" });
            if (failure === "quota") throw new FsError("ENOSPC");
          }
          writeOptions.signal?.throwIfAborted();
          if (failure === "commit") throw new FsError("ENOSPC", { message: "commit quota" });
          const bytes = new Uint8Array(Buffer.concat(collected));
          if (writeOptions.flag === "a") await backing.appendFile(path, bytes);
          else await backing.writeFile(path, bytes);
        } finally { state.active--; }
      };
      if (key === "writeFile" || key === "appendFile") return async (...args: Parameters<FileSystem["writeFile"]>) => {
        state.mutations++;
        return target[key](...args);
      };
      const member: unknown = Reflect.get(target, key);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  const shell = new Shell({ fs, limits: {
    ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
    ...(options.maxWallClockMs === undefined ? {} : { maxWallClockMs: options.maxWallClockMs }),
  } })
    .use(browserCommands()).use(networkCommands({
      authorize: () => true,
      transport: async request => ({
        status: 200, statusText: "OK", headers: [],
        body: options.body?.(request.signal) ?? (async function* () { for (const chunk of chunks) { state.produced++; yield chunk; } })(),
        async dispose() { state.disposed++; },
      }),
    }));
  return { backing, fs, state, shell };
}

for (const route of routes) {
  for (const [name, chunks] of [
    ["split UTF8", [Uint8Array.of(0xc3), Uint8Array.of(0xa9)]],
    ["binary", [Uint8Array.of(0, 255, 128), Uint8Array.of(195, 0, 13, 10)]],
    ["empty", []],
  ] as const) {
    test(`${route.name}: atomic stream ${name}`, async () => {
      const { backing, shell, state } = fixture(chunks);
      await backing.writeFile("/out", original);
      try {
        const result = await shell.exec(route.command);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(await backing.readFile("/out"), new Uint8Array(Buffer.concat([...(route.append ? [original] : []), ...chunks])));
        assert.equal(state.streams, 1);
        assert.equal(state.mutations, 0);
        assert.equal(state.active, 0);
      } finally { await shell.dispose(); }
    });
  }
  for (const failure of ["after", "quota", "commit"] as const) {
    test(`${route.name}: ${failure} never replays or commits a prefix`, async () => {
      const { backing, shell, state } = fixture([Uint8Array.of(1), Uint8Array.of(2)], { failure });
      await backing.writeFile("/out", original);
      try {
        const result = await shell.exec(route.command);
        assert.notEqual(result.exitCode, 0);
        assert.deepEqual(await backing.readFile("/out"), original);
        assert.equal(state.mutations, 0);
        assert.equal(state.active, 0);
      } finally { await shell.dispose(); }
    });
  }
  test(`${route.name}: global byte budget preserves atomic original`, async () => {
    const { backing, shell, state } = fixture([Uint8Array.of(1, 2), Uint8Array.of(3, 4)], { maxOutputBytes: 3 });
    await backing.writeFile("/out", original);
    try {
      await assert.rejects(shell.exec(route.command), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
      assert.deepEqual(await backing.readFile("/out"), original);
      assert.equal(state.active, 0);
    } finally { await shell.dispose(); }
  });
  test(`${route.name}: read-only preflight preserves original`, async () => {
    const { backing, shell, state } = fixture([Uint8Array.of(1)], { readOnly: true });
    await backing.writeFile("/out", original);
    try {
      const result = await shell.exec(route.command);
      assert.notEqual(result.exitCode, 0);
      assert.deepEqual(await backing.readFile("/out"), original);
      assert.equal(state.mutations, 0);
      assert.equal(state.streams, 0);
    } finally { await shell.dispose(); }
  });
  test(`${route.name}: unsupported stream before consumption uses incremental fallback`, async () => {
    const chunks = [Uint8Array.of(195), Uint8Array.of(169)];
    const { backing, shell, state } = fixture(chunks, { failure: "before" });
    await backing.writeFile("/out", original);
    try {
      const result = await shell.exec(route.command);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(await backing.readFile("/out"), new Uint8Array(Buffer.concat([...(route.append ? [original] : []), ...chunks])));
      assert.equal(state.streams, 1);
      assert.equal(state.produced, 2);
      assert.equal(state.active, 0);
    } finally { await shell.dispose(); }
  });
  test(`${route.name}: abort joins writer and response disposal`, async () => {
    const controller = new AbortController();
    const reason = new Error("cancel output");
    let sourceClosed = false;
    const { backing, shell, state } = fixture([], { body: signal => (async function* () {
      try {
        yield Uint8Array.of(1);
        controller.abort(reason);
        signal.throwIfAborted();
      } finally { sourceClosed = true; }
    })() });
    await backing.writeFile("/out", original);
    try {
      await assert.rejects(shell.exec(route.command, { signal: controller.signal }), error => error === reason);
      assert.equal(sourceClosed, true);
      assert.equal(state.active, 0);
      assert.equal(state.disposed, 1);
      assert.deepEqual(await backing.readFile("/out"), original);
    } finally { await shell.dispose(); }
  });
  test(`${route.name}: swallowed curl source failure aborts atomic output`, async () => {
    const { backing, shell, state } = fixture([], { body: () => (async function* () {
      yield Uint8Array.of(195);
      throw new Error("source failed after prefix");
    })() });
    await backing.writeFile("/out", original);
    try {
      const result = await shell.exec(route.command);
      assert.notEqual(result.exitCode, 0);
      assert.deepEqual(await backing.readFile("/out"), original);
      assert.equal(state.active, 0);
    } finally { await shell.dispose(); }
  });
  test(`${route.name}: global time budget terminates pending response and writer`, async () => {
    let returned = false;
    const { backing, shell, state } = fixture([], { maxWallClockMs: 15, body: signal => ({ [Symbol.asyncIterator]() {
      let first = true;
      return {
        next() {
          if (first) { first = false; return Promise.resolve({ value: Uint8Array.of(1), done: false as const }); }
          return new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => {
            if (signal.aborted) reject(signal.reason);
            else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
        async return() { returned = true; return { value: undefined, done: true as const }; },
      };
    } }) });
    await backing.writeFile("/out", original);
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      await assert.rejects(shell.exec(route.command), error => error instanceof ShellLimitError && error.limit === "maxWallClockMs");
      assert.equal(returned, true);
      assert.equal(state.active, 0);
      assert.equal(state.disposed, 1);
      assert.deepEqual(await backing.readFile("/out"), original);
    } finally { clearTimeout(keepAlive); await shell.dispose(); }
  });
}

for (const route of routes.filter(route => route.append)) {
  test(`${route.name}: streaming append works without incremental append`, async () => {
    const { backing, shell, state } = fixture([Uint8Array.of(195), Uint8Array.of(169)], { append: false, streamingAppend: true });
    await backing.writeFile("/out", original);
    try {
      const result = await shell.exec(route.command);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(await backing.readFile("/out"), new Uint8Array(Buffer.concat([original, Uint8Array.of(195, 169)])));
      assert.equal(state.mutations, 0);
    } finally { await shell.dispose(); }
  });
  test(`${route.name}: unsupported append preserves original`, async () => {
    const { backing, shell, state } = fixture([Uint8Array.of(1)], { append: false });
    await backing.writeFile("/out", original);
    try {
      const result = await shell.exec(route.command);
      assert.notEqual(result.exitCode, 0);
      assert.deepEqual(await backing.readFile("/out"), original);
      assert.equal(state.mutations, 0);
    } finally { await shell.dispose(); }
  });
}

test("ordinary nonzero command still opens and truncates atomic redirection", async () => {
  const { backing, shell } = fixture([]);
  await backing.writeFile("/out", original);
  try {
    assert.equal((await shell.exec("false > /out")).exitCode, 1);
    assert.deepEqual(await backing.readFile("/out"), new Uint8Array());
  } finally { await shell.dispose(); }
});

test("duplicated descriptors share one atomic stream across compound commands", async () => {
  const { backing, shell, state } = fixture([]);
  try {
    const result = await shell.exec("{ printf a >&3; printf b >&4; printf c >&3; } 3>/out 4>&3");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(await backing.readFile("/out")), "abc");
    assert.equal(state.streams, 1);
  } finally { await shell.dispose(); }
});

test("atomic conflicting opens refuse without committing or leaking the earlier stream", async () => {
  const { backing, shell, state } = fixture([]);
  await backing.writeFile("/out", original);
  try {
    const result = await shell.exec("printf data >/out 2>/out");
    assert.notEqual(result.exitCode, 0);
    assert.deepEqual(await backing.readFile("/out"), original);
    assert.equal(state.active, 0);
  } finally { await shell.dispose(); }
});

test("ignored writer failures cannot become successful shell completion", async () => {
  const { backing, shell } = fixture([], { failure: "after" });
  await backing.writeFile("/out", original);
  shell.commands.register({ name: "ignore-write", async execute(context) {
    await context.stdout.write(Uint8Array.of(1)).catch(() => {});
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec("ignore-write > /out");
    assert.notEqual(result.exitCode, 0);
    assert.deepEqual(await backing.readFile("/out"), original);
  } finally { await shell.dispose(); }
});

test("normal exit control completes atomic compound redirection", async () => {
  const { backing, shell } = fixture([]);
  try {
    const result = await shell.exec("{ printf data; exit 0; } >/out");
    assert.equal(result.exitCode, 0);
    assert.equal(new TextDecoder().decode(await backing.readFile("/out")), "data");
  } finally { await shell.dispose(); }
});

for (const failure of ["after", "commit"] as const) {
  for (const append of [false, true]) {
    test(`tee ${append ? "append" : "overwrite"} retains successful targets when one fails ${failure}`, async () => {
      const chunks = [Uint8Array.of(195), Uint8Array.of(169)];
      const { backing, shell, state } = fixture(chunks, { failure, failurePath: "/bad" });
      for (const path of ["/out", "/bad", "/last"]) await backing.writeFile(path, original);
      try {
        const result = await shell.exec(`curl https://example.invalid/body | tee ${append ? "-a " : ""}/out /bad /last`);
        assert.equal(result.exitCode, 1, result.stderr);
        assert.deepEqual(result.stdoutBytes, new Uint8Array(Buffer.concat(chunks)));
        assert.deepEqual(await backing.readFile("/bad"), original);
        for (const path of ["/out", "/last"]) assert.deepEqual(await backing.readFile(path), new Uint8Array(Buffer.concat([...(append ? [original] : []), ...chunks])));
        assert.equal(state.active, 0);
      } finally { await shell.dispose(); }
    });
  }
}

test("tee early-closing downstream aborts atomic destinations and joins writers", async () => {
  const { backing, shell, state } = fixture(Array.from({ length: 8 }, () => new Uint8Array(65_536)));
  for (const path of ["/out", "/second"]) await backing.writeFile(path, original);
  try {
    const result = await shell.exec("curl https://example.invalid/body | tee /out /second | head -c 1");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdoutBytes.length, 1);
    for (const path of ["/out", "/second"]) assert.deepEqual(await backing.readFile(path), original);
    assert.equal(state.active, 0);
    assert.equal(state.disposed, 1);
    assert.ok(state.produced < 8);
  } finally { await shell.dispose(); }
});

test("tee without destinations and empty multi-target output settle", async () => {
  const { backing, shell, state } = fixture([]);
  try {
    for (const command of ["printf '' | tee", "printf '' | tee /out /second"]) assert.equal((await shell.exec(command)).exitCode, 0);
    assert.deepEqual(await backing.readFile("/out"), new Uint8Array());
    assert.deepEqual(await backing.readFile("/second"), new Uint8Array());
    assert.equal(state.streams, 2);
    assert.equal(state.active, 0);
  } finally { await shell.dispose(); }
});

test("writable mount capability wins over a read-only root profile", async () => {
  const { fs, backing, shell: unused } = fixture([]);
  await unused.dispose();
  const mounted = createMountFileSystem({ root: createReadOnlyFileSystem(createMemoryFileSystem()), mounts: { "/writable": fs } });
  const shell = new Shell({ fs: mounted }).use(browserCommands());
  try {
    for (const command of ["printf a >/writable/out", "printf b >>/writable/out", "printf c | tee /writable/tee"]) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, result.stderr);
    }
    assert.equal(new TextDecoder().decode(await backing.readFile("/out")), "ab");
    assert.equal(new TextDecoder().decode(await backing.readFile("/tee")), "c");
  } finally { await shell.dispose(); }
});

for (const route of routes.filter(route => !route.name.startsWith("tee"))) {
  test(`${route.name}: writer failure cancels a pending network producer`, async () => {
    const backing = createMemoryFileSystem();
    await backing.writeFile("/out", original);
    let failWriter!: () => void;
    const failure = new FsError("EIO", { message: "asynchronous writer failure" });
    const failing = new Promise<never>((_resolve, reject) => { failWriter = () => reject(failure); });
    let active = 0;
    const fs = new Proxy(backing, { get(target, key) {
      if (key === "capabilities") return { ...target.capabilities, randomAccessWrite: false };
      if (key === "writeStream") return async (_path: string, source: ByteSource) => {
        active++;
        const consuming = (async () => {
          try { for await (const chunk of source) assert.ok(chunk instanceof Uint8Array); }
          finally { active--; }
        })();
        await Promise.race([consuming, failing]);
      };
      const member: unknown = Reflect.get(target, key);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    let returned = false;
    let disposed = 0;
    let releaseRead: (() => void) | undefined;
    const shell = new Shell({ fs }).use(browserCommands()).use(networkCommands({
      authorize: () => true,
      transport: async request => ({ status: 200, statusText: "OK", headers: [],
        body: { [Symbol.asyncIterator]() {
          let first = true;
          return {
            next() {
              if (first) { first = false; return Promise.resolve({ done: false as const, value: Uint8Array.of(1) }); }
              failWriter();
              return new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => {
                releaseRead = () => reject(failure);
                if (request.signal.aborted) releaseRead();
                else request.signal.addEventListener("abort", releaseRead, { once: true });
              });
            },
            async return() { returned = true; return { done: true as const, value: undefined }; },
          };
        } },
        async dispose() { disposed++; releaseRead?.(); },
      }),
    }));
    const controller = new AbortController();
    const watchdog = setTimeout(() => controller.abort(new Error("writer did not cancel pending producer")), 100);
    try {
      const result = await shell.exec(route.command, { signal: controller.signal });
      assert.equal(result.exitCode, 23, result.stderr);
      assert.deepEqual(await backing.readFile("/out"), original);
      assert.equal(active, 0);
      assert.equal(returned, true);
      assert.equal(disposed, 1);
    } finally { clearTimeout(watchdog); await shell.dispose(); }
  });
}

test("curl header file uses the shared streaming lifecycle", async () => {
  const { backing, shell, state } = fixture([]);
  try {
    const result = await shell.exec("curl -D /headers https://example.invalid/body");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(await backing.readFile("/headers")), "HTTP/1.1 200 OK\r\n\r\n");
    assert.equal(state.streams, 1);
    assert.equal(state.mutations, 0);
  } finally { await shell.dispose(); }
});

test("curl header file shares the shell byte budget and preserves atomic original", async () => {
  const { backing, shell, state } = fixture([], { maxOutputBytes: 8 });
  await backing.writeFile("/headers", original);
  try {
    await assert.rejects(shell.exec("curl -D /headers https://example.invalid/body"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.deepEqual(await backing.readFile("/headers"), original);
    assert.equal(state.active, 0);
  } finally { await shell.dispose(); }
});

for (const command of ["printf data >/out", "printf data | tee /out", "curl -o /out https://example.invalid/body", "curl -D /out https://example.invalid/body"]) {
  test(`stream-only output succeeds without ordinary write capability: ${command}`, async () => {
    const { backing, shell, state } = fixture([new TextEncoder().encode("data")], { write: false, append: false });
    await backing.writeFile("/out", original);
    try {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(state.streams, 1);
      assert.equal(state.mutations, 0);
      assert.notDeepEqual(await backing.readFile("/out"), original);
    } finally { await shell.dispose(); }
  });
  test(`unsupported stream cannot fall back to forbidden ordinary write: ${command}`, async () => {
    const { backing, shell, state } = fixture([], { write: false, failure: "before" });
    await backing.writeFile("/out", original);
    try {
      const result = await shell.exec(command);
      assert.notEqual(result.exitCode, 0);
      assert.equal(state.mutations, 0);
      assert.deepEqual(await backing.readFile("/out"), original);
    } finally { await shell.dispose(); }
  });
}

for (const route of routes.filter(route => route.append)) {
  for (const initial of [undefined, new Uint8Array(), original]) {
    for (const chunks of [[], [Uint8Array.of(195), Uint8Array.of(169)]] as const) {
      test(`${route.name}: independent streaming append, ${initial === undefined ? "new" : initial.length ? "existing" : "empty"} target, ${chunks.length ? "split UTF8" : "empty input"}`, async () => {
        const { backing, shell, state } = fixture(chunks, { streamingAppend: true, streamingWrite: false, append: false, write: false });
        if (initial) await backing.writeFile("/out", initial);
        try {
          const result = await shell.exec(route.command);
          assert.equal(result.exitCode, 0, result.stderr);
          assert.deepEqual(await backing.readFile("/out"), new Uint8Array(Buffer.concat([...(initial ? [initial] : []), ...chunks])));
          assert.equal(state.streams, 1);
          assert.equal(state.mutations, 0);
          assert.equal(state.active, 0);
        } finally { await shell.dispose(); }
      });
    }
  }
}

for (const command of ["printf data >/out", "printf data | tee /out", "curl -o /out https://example.invalid/body", "curl -D /out https://example.invalid/body"]) {
  test(`independent streaming append cannot authorize overwrite: ${command}`, async () => {
    const { backing, shell, state } = fixture([Uint8Array.of(1)], { streamingAppend: true, streamingWrite: false, append: false, write: false });
    await backing.writeFile("/out", original);
    try {
      const result = await shell.exec(command);
      assert.notEqual(result.exitCode, 0);
      assert.deepEqual(await backing.readFile("/out"), original);
      assert.equal(state.streams, 0);
      assert.equal(state.mutations, 0);
      assert.equal(state.active, 0);
      if (command.includes("tee")) assert.equal(result.stdout, "data");
    } finally { await shell.dispose(); }
  });
}

for (const randomAccessWrite of [false, true]) {
  for (const route of [">>", "tee -a"]) {
    for (const initial of [undefined, new Uint8Array(), original]) {
      for (const payload of ["", "data"]) {
        test(`${route}: append-only ${randomAccessWrite ? "random" : "sequential"} output, ${initial === undefined ? "new" : initial.length ? "existing" : "empty"} target, ${payload ? "data" : "empty input"}`, async () => {
          const backing = createMemoryFileSystem();
          if (initial) await backing.writeFile("/out", initial);
          let forbiddenWrites = 0;
          let appends = 0;
          const fs = new Proxy(backing, { get(target, key) {
            if (key === "capabilities") return { ...target.capabilities, randomAccessWrite, append: true, write: false, streamingWrite: false, streamingAppend: false };
            if (key === "writeFile") return async () => { forbiddenWrites++; throw new FsError("ENOTSUP"); };
            if (key === "appendFile") return async (...args: Parameters<FileSystem["appendFile"]>) => { appends++; await backing.appendFile(...args); };
            const member: unknown = Reflect.get(target, key);
            return typeof member === "function" ? member.bind(target) : member;
          } });
          const shell = new Shell({ fs }).use(browserCommands());
          try {
            const result = await shell.exec(`printf '${payload}' ${route === ">>" ? ">> /out" : "| tee -a /out"}`);
            assert.equal(result.exitCode, 0, result.stderr);
            assert.equal(forbiddenWrites, 0);
            assert.equal(appends, payload ? 2 : 1);
            assert.deepEqual(await backing.readFile("/out"), new Uint8Array(Buffer.concat([initial ?? new Uint8Array(), new TextEncoder().encode(payload)])));
          } finally { await shell.dispose(); }
        });
      }
    }
  }
}
