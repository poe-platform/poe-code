import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { cmpCommand } from "../../src/commands/cmp.js";
import {
  FsError,
  type ByteSource,
  type CommandContext,
  type InvocationCleanup
} from "../../src/contracts/index.js";
import { fixture } from "./helpers.js";

for (const [name, script, expected] of [
  ["left pipe skip", "cat left | { cmp -n0 -i2:0 - right; cat; }", [128, 255]],
  ["right pipe skip", "cat left | { cmp -n0 -i0:2 right -; cat; }", [128, 255]],
  ["no skip pipe", "cat left | { cmp -n0 - right; cat; }", [1, 2, 128, 255]],
  ["seekable skip", "{ cmp -n0 -i2:0 - right; cat; } <left", [128, 255]]
] as const)
  test(`cmp GNU zero-limit prefix consumption: ${name}`, async () => {
    const shell = new Shell({
      fs: await fixture({ left: Uint8Array.of(1, 2, 128, 255), right: Uint8Array.of(1) }),
      cwd: "/work",
      env: { LC_ALL: "C" }
    }).use(standardCommands());
    try {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0);
      assert.deepEqual(result.stdoutBytes, Uint8Array.from(expected));
      assert.equal(result.stderr, "");
    } finally {
      await shell.dispose();
    }
  });

for (const skip of [0, 1, 4095, 4096, 4097, 8192, 8193])
  for (const side of ["left", "right"]) {
    test(`cmp zero-limit borrowed input skip=${skip} side=${side} stops at the prefix boundary`, async () => {
      const fs = await fixture({ file: Uint8Array.of(1) });
      let position = 0;
      const requests: number[] = [];
      const payload = Uint8Array.from({ length: 8192 }, (_, index) => index % 256);
      const context: CommandContext = {
        command: "cmp",
        args: [
          "-n0",
          side === "left" ? `-i${skip}:0` : `-i0:${skip}`,
          ...(side === "left" ? ["-", "file"] : ["file", "-"])
        ],
        cwd: "/work",
        env: { LC_ALL: "C" },
        fs,
        signal: new AbortController().signal,
        stdin: {
          [Symbol.asyncIterator]() {
            assert.fail("bounded stdin admission was bypassed");
          }
        },
        stdinInput: {
          get position() {
            return position;
          },
          async read(maxBytes, signal) {
            signal.throwIfAborted();
            requests.push(maxBytes);
            assert.ok(maxBytes > 0 && maxBytes <= 4096 && maxBytes <= skip - position);
            if (position === payload.length) return { done: true, value: undefined };
            const value = payload.slice(position, position + Math.min(maxBytes, 997));
            position += value.length;
            return { done: false, value };
          }
        },
        stdout: {
          async write() {
            assert.fail("zero comparison must not produce output");
          }
        },
        stderr: {
          async write() {
            assert.fail("zero comparison must not produce diagnostics");
          }
        }
      };
      assert.equal((await cmpCommand().execute(context)).exitCode, 0);
      assert.equal(position, Math.min(skip, payload.length));
      assert.equal(requests.length === 0, skip === 0);
      assert.deepEqual(payload.slice(position), payload.slice(Math.min(skip, payload.length)));
    });
  }

for (const script of [
  "cat left | { cmp -n0 -i4:0 - right; cat; }",
  "cat left | { cmp -n0 -i5:0 - right; cat; }",
  "cat left | { cmp -n8 -n0 -i2:0 - right; cat; }",
  "cat left | { cmp -n0 -n8 -i2:0 - right; cat; }"
])
  test(`cmp zero-limit skip preserves EOF and repeated minimum: ${script}`, async () => {
    const shell = new Shell({ fs: await fixture({ left: "abcd", right: "a" }), cwd: "/work" }).use(
      standardCommands()
    );
    try {
      const result = await shell.exec(script);
      assert.deepEqual(
        [result.exitCode, result.stdout, result.stderr],
        [0, script.includes("-i2:0") ? "cd" : "", ""]
      );
    } finally {
      await shell.dispose();
    }
  });

for (const silent of [false, true])
  test(`cmp opens both operands before zero-limit discard: silent=${silent}`, async () => {
    const shell = new Shell({ fs: await fixture({ left: "abcd" }), cwd: "/work" }).use(
      standardCommands()
    );
    try {
      for (const operands of ["-i2:0 - missing", "-i0:2 missing -"]) {
        const result = await shell.exec(
          `cat left | { cmp ${silent ? "-s " : ""}-n0 ${operands}; printf '%s:' "$?"; cat; }`
        );
        assert.deepEqual(
          [result.exitCode, result.stdout, result.stderr],
          [0, "2:abcd", silent ? "" : "cmp: missing: No such file or directory\n"]
        );
      }
    } finally {
      await shell.dispose();
    }
  });

test("cmp same-identity stdin shortcuts precede prefix reads", async () => {
  const shell = new Shell({ fs: await fixture({ left: "abcd" }), cwd: "/work" }).use(
    standardCommands()
  );
  try {
    for (const flags of ["-n0 -i2:2", "-n0 -i1:2", "-i2:2"]) {
      const result = await shell.exec(`cat left | { cmp ${flags} - -; cat; }`);
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "abcd", ""]);
    }
  } finally {
    await shell.dispose();
  }
});

for (const silent of [false, true])
  test(`cmp zero-limit prefix read failures remain trouble: silent=${silent}`, async () => {
    let returned = 0;
    const source: ByteSource = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<Uint8Array>> {
            throw new FsError("EIO");
          },
          async return() {
            returned++;
            return { done: true, value: undefined };
          }
        };
      }
    };
    const shell = new Shell({ fs: await fixture({ right: "a" }), cwd: "/work" }).use(
      standardCommands()
    );
    try {
      const result = await shell.exec(`cmp ${silent ? "-s " : ""}-n0 -i2:0 - right`, {
        stdin: source
      });
      assert.deepEqual(
        [result.exitCode, result.stdout, result.stderr],
        [2, "", "cmp: -: Input/output error\n"]
      );
      assert.equal(returned, 1);
    } finally {
      await shell.dispose();
    }
  });

for (const reason of [false, 0, null])
  test(`cmp zero-limit owned prefix cancellation preserves ${String(reason)} and awaited retirement`, async () => {
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const retirement = new Promise<void>((resolve) => {
      release = resolve;
    });
    let returned = 0;
    let pulls = 0;
    const source: ByteSource = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            pulls++;
            entered();
            return { done: false, value: Uint8Array.of(1) };
          },
          async return() {
            returned++;
            await retirement;
            return { done: true, value: undefined };
          }
        };
      }
    };
    const fs = await fixture({ right: "a" });
    let cleanup: InvocationCleanup | undefined;
    let settled = false;
    const running = Promise.resolve(
      cmpCommand().execute({
        command: "cmp",
        args: ["-n0", "-i9223372036854775807:0", "-", "right"],
        cwd: "/work",
        env: {},
        fs,
        stdin: source,
        signal: controller.signal,
        registerCleanup(close) {
          assert.equal(cleanup, undefined);
          cleanup = close;
        },
        stdout: {
          async write() {
            assert.fail("canceled comparison wrote stdout");
          }
        },
        stderr: {
          async write() {
            assert.fail("canceled comparison wrote stderr");
          }
        }
      })
    );
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    try {
      await Promise.race([started, running, new Promise<void>((resolve) => setImmediate(resolve))]);
      assert.ok(pulls > 0, "zero-limit execution never entered prefix consumption");
      controller.abort(reason);
      for (let turn = 0; turn < 20 && returned === 0; turn++)
        await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(returned, 1);
      assert.equal(settled, false);
      assert.ok(cleanup);
      const closing = cleanup();
      release();
      await assert.rejects(running, (error) => error === reason);
      await closing;
      assert.equal(returned, 1);
    } finally {
      release();
      controller.abort(reason);
      await running.catch(() => {});
    }
  });

for (const limit of [0, 1])
  for (const skip of [0, 2])
    test(`cmp nonregular named stream prefix has positive chunk admission: skip=${skip} limit=${limit}`, async () => {
      const memory = await fixture({ stream: "abc", right: "a" });
      const chunks: number[] = [];
      let pulls = 0;
      let closed = 0;
      const capabilities = { ...memory.capabilities, retainedRead: false };
      const fs = new Proxy(memory, {
        get(target, key) {
          if (key === "capabilities") return capabilities;
          if (key === "capabilitiesFor") return async () => capabilities;
          if (key === "stat")
            return async (path: string) => {
              const stat = await target.stat(path);
              return path === "/work/stream" ? { ...stat, type: "character" } : stat;
            };
          if (key === "readStream")
            return (path: string, options: { chunkSize: number }) => {
              if (path !== "/work/stream") return target.readStream(path, options);
              chunks.push(options.chunkSize);
              assert.ok(
                options.chunkSize > 0 && options.chunkSize <= 4096,
                "nonregular stream chunk size must be positive"
              );
              return {
                [Symbol.asyncIterator]() {
                  return {
                    async next() {
                      pulls++;
                      assert.ok(
                        pulls <= skip + limit,
                        "read beyond skipped prefix and comparison limit"
                      );
                      return { done: false, value: Uint8Array.of(97) };
                    },
                    async return() {
                      closed++;
                      return { done: true, value: undefined };
                    }
                  };
                }
              };
            };
          const value: unknown = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
      const errors: unknown[] = [];
      const result = await cmpCommand().execute({
        command: "cmp",
        args: [`-n${limit}`, `-i${skip}:0`, "stream", "right"],
        cwd: "/work",
        env: {},
        fs,
        signal: new AbortController().signal,
        stdin: {
          async *[Symbol.asyncIterator]() {
            yield new Uint8Array();
          }
        },
        stdout: { async write() {} },
        stderr: { async write() {} },
        onInternalError(error) {
          errors.push(error);
        }
      });
      assert.deepEqual([result.exitCode, errors.map(String)], [0, []]);
      assert.equal(pulls, skip + limit);
      assert.deepEqual(chunks, skip || limit ? [limit || skip] : []);
      assert.equal(closed, skip || limit ? 1 : 0);
    });
