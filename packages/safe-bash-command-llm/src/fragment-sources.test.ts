import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { createLlmFragmentSource } from "./fragments.js";

test("SDK system fragments trim across retained chunks without whole-file reads", async () => {
  const backing = new MemoryFileSystem();
  const fs = new Proxy(backing, {
    get(target, key) {
      if (key === "readFile")
        return async () => {
          throw new Error("must use retained reads");
        };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  let disposed = 0,
    charged = 0;
  const source = await createLlmFragmentSource({
    fs,
    directory: "/",
    signal: new AbortController().signal,
    system: true,
    fragments: {
      async *[Symbol.asyncIterator]() {
        yield {
          async dispose() {
            disposed++;
          },
          bytes: {
            async *[Symbol.asyncIterator]() {
              for (let i = 0; i < 64; i++) yield new Uint8Array(16384).fill(32);
              yield Uint8Array.of(0xf0, 0x9f);
              yield Uint8Array.of(0x99, 0x82, 32);
              for (let i = 0; i < 64; i++) yield new Uint8Array(16384).fill(32);
            }
          }
        };
      }
    },
    admitBytes: (size) => {
      charged += size;
    }
  });
  let result = "";
  for await (const bytes of source.bytes) {
    assert.ok(bytes.length <= 16384);
    result += new TextDecoder().decode(bytes);
  }
  assert.equal(result, "🙂");
  assert.equal(disposed, 1);
  assert.equal(charged, 128 * 16384 + 5);
  await source.dispose();
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const kind of ["budget", "utf8"] as const)
  test(`SDK fragment ${kind} failures retire inputs and scratch`, async () => {
    const fs = new MemoryFileSystem();
    let disposed = 0,
      tailDisposed = 0,
      pulls = 0;
    await assert.rejects(
      createLlmFragmentSource({
        fs,
        directory: "/",
        signal: new AbortController().signal,
        fragments: {
          async *[Symbol.asyncIterator]() {
            yield {
              async dispose() {
                disposed++;
              },
              bytes: {
                async *[Symbol.asyncIterator]() {
                  pulls++;
                  yield Uint8Array.of(255);
                  pulls++;
                  yield Uint8Array.of(65);
                }
              }
            };
          }
        },
        tail: {
          bytes: toByteSource("tail"),
          async dispose() {
            tailDisposed++;
          }
        },
        admitBytes() {
          if (kind === "budget") throw new Error("budget exceeded");
        }
      }),
      kind === "budget" ? /budget exceeded/ : /encoded data/
    );
    assert.equal(pulls, 1);
    assert.equal(disposed, 1);
    assert.equal(tailDisposed, 1);
    assert.deepEqual(await fs.readdir("/"), []);
  });

test("SDK file newline normalization retains CR state across input chunks", async () => {
  const fs = new MemoryFileSystem();
  const source = await createLlmFragmentSource({
    fs,
    directory: "/",
    signal: new AbortController().signal,
    normalizeNewlines: true,
    fragments: {
      async *[Symbol.asyncIterator]() {
        yield {
          async dispose() {},
          bytes: {
            async *[Symbol.asyncIterator]() {
              yield Uint8Array.of(65, 13);
              yield Uint8Array.of(10, 66, 13);
              yield Uint8Array.of(67);
            }
          }
        };
      }
    }
  });
  let result = "";
  for await (const bytes of source.bytes) result += new TextDecoder().decode(bytes);
  assert.equal(result, "A\nB\nC");
  await source.dispose();
  assert.deepEqual(await fs.readdir("/"), []);
});

test("SDK cancellation retires a late fragment acquisition without waiting for it", async () => {
  const fs = new MemoryFileSystem(),
    controller = new AbortController(),
    failure = new Error("cancel fragments");
  let resolveNext!: (value: IteratorResult<import("./types.js").LlmInputSource>) => void,
    started!: () => void,
    retired = 0,
    disposed = 0;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = createLlmFragmentSource({
    fs,
    directory: "/",
    signal: controller.signal,
    fragments: {
      [Symbol.asyncIterator]() {
        return {
          next() {
            started();
            return new Promise((resolve) => {
              resolveNext = resolve;
            });
          },
          async return() {
            retired++;
            return { done: true, value: undefined };
          }
        };
      }
    }
  });
  await ready;
  controller.abort(failure);
  await assert.rejects(pending, (error) => error === failure);
  resolveNext({
    done: false,
    value: {
      bytes: toByteSource("late"),
      async dispose() {
        disposed++;
      }
    }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disposed, 1);
  assert.equal(retired, 1);
  assert.deepEqual(await fs.readdir("/"), []);
});

for (const streamed of [false, true])
  test(`CLI fragment input admission and cleanup, source=${streamed}`, async () => {
    const { createLlmCommand } = await import("./command.js");
    const fs = new MemoryFileSystem();
    await fs.writeFile("/large", new Uint8Array(512).fill(97));
    let calls = 0,
      stderr = "";
    const command = createLlmCommand({
      defaultModel: "fixture",
      limits: { maxInputBytes: 1024, maxBufferedInputBytes: 64 },
      providers: [
        {
          name: "fixture",
          models: [{ id: "fixture" }],
          async *complete() {
            calls++;
            yield "wrong";
          },
          ...(streamed
            ? {
                async *completeSources(request: import("./types.js").LlmSourceRequest) {
                  calls++;
                  let size = 0;
                  for await (const bytes of request.prompt.bytes) size += bytes.length;
                  assert.equal(size, 512);
                  yield "ok";
                }
              }
            : {})
        }
      ]
    });
    const result = await command.execute({
      command: "llm",
      args: ["-f", "/large"],
      fs,
      cwd: "/",
      env: {},
      signal: new AbortController().signal,
      stdin: toByteSource(""),
      stdout: { async write() {} },
      stderr: {
        async write(bytes) {
          stderr += new TextDecoder().decode(bytes);
        }
      }
    });
    assert.equal(result.exitCode, streamed ? 0 : 1, stderr);
    assert.equal(calls, streamed ? 1 : 0);
    assert.deepEqual(
      (await fs.readdir("/")).map((entry) => entry.name),
      ["large"]
    );
  });
