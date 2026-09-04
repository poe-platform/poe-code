import assert from "node:assert/strict";
import { test } from "node:test";
import { type ByteSource, type CommandContext, type FileSystem, type InvocationCleanup } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { defaultJqLimits, JqLimitError } from "../../../src/commands/structured/limits.js";
import { createYqQuerySession } from "../../../src/commands/structured/query-core.js";
import { yqCaps } from "../../../src/commands/yq/accounting.js";
import { createYqCommand } from "../../../src/commands/yq/index.js";

function syntheticChunk(text: string, admittedBytes: number): Uint8Array {
  const chunk = Buffer.from(text);
  Object.defineProperty(chunk, "byteLength", { value: admittedBytes });
  return chunk;
}

async function run(overrides: Partial<CommandContext> = {}) {
  let stdout = "";
  let stderr = "";
  const context: CommandContext = {
    command: "yq", args: ["-o", "json", "-c", "."],
    stdin: (async function* () { yield Buffer.from("1\n"); })(),
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
    ...overrides,
  };
  const result = await createYqCommand().execute(context);
  return { status: result.exitCode, stdout, stderr };
}

test("yq input default is decimal 16 MB and other caps remain unchanged", () => {
  assert.deepEqual(yqCaps, {
    maxArgvEntries: 4096, maxArgvUtf8Bytes: 65_536, maxVfsOperandPathBytes: 16_384,
    maxInputBytes: 16_000_000, maxDocumentBytes: 8_388_608, maxValueBytes: 8_388_608,
    maxScalarBytes: 1_048_576, maxQuerySourceBytes: 8192, maxDepth: 128, maxAstDepth: 64,
    maxSteps: 1_000_000, maxResults: 100_000, maxCollectionSize: 100_000,
    maxDocuments: 1024, maxAnchorsPerDocument: 1024, maxAliasReferences: 1024,
    maxDocumentNodes: 100_000, maxOutputBytes: 16_777_216, diagnosticReserveBytes: 4096,
    stdoutCapBytes: 16_773_120, maxDisplayedFilenameBytes: 256,
  });
  assert.deepEqual(defaultJqLimits, {
    maxInputBytes: 67_108_864, maxValueBytes: 8_388_608, maxOutputBytes: 16_777_216,
    maxSourceBytes: 65_536, maxDepth: 128, maxAstDepth: 64, maxSteps: 1_000_000,
    maxResults: 100_000, maxCollectionSize: 100_000,
  });
});

for (const admissions of [[16_000_000], [8_000_000, 7_999_999, 1]]) {
  test(`yq numeric admission accepts exact cap then rejects one byte: ${admissions.join("+")}`, async () => {
    const session = createYqQuerySession({ signal: new AbortController().signal });
    try {
      for (const bytes of admissions) session.ownedWork.admitInputBytes(bytes);
      assert.throws(() => session.ownedWork.admitInputBytes(1), JqLimitError);
      session.ownedWork.admitInputBytes(0);
    } finally { await session.close(); }
  });
}

test("yq numeric admission rejects cap plus one on a fresh session", async () => {
  const session = createYqQuerySession({ signal: new AbortController().signal });
  try {
    assert.throws(() => session.ownedWork.admitInputBytes(16_000_001), JqLimitError);
    session.ownedWork.admitInputBytes(16_000_000);
  } finally { await session.close(); }
});

for (const streaming of [true, false]) {
  test(`yq cumulative multi-source admission rejects before owned copy: ${streaming ? "stream" : "readFile"}`, async context => {
    const first = syntheticChunk("1\n", 8_000_000);
    const second = syntheticChunk("2\n", 8_000_000);
    const rejected = syntheticChunk("3\n", 1);
    const chunks = new Map([["/first", first], ["/second", second], ["/rejected", rejected]]);
    const copied: Uint8Array[] = [];
    const opened: string[] = [];
    let closed = 0;
    context.mock.method(globalThis, "Uint8Array", new Proxy(Uint8Array, {
      construct(target, args, newTarget) {
        if (typeof args[0] === "number" && args[0] > 1024) {
          assert.fail("unexpected large allocation");
        }
        if (args[0] === first || args[0] === second || args[0] === rejected) copied.push(args[0]);
        return Reflect.construct(target, args, newTarget);
      },
    }));
    const fs: FileSystem = createMemoryFileSystem();
    if (streaming) {
      fs.readStream = async function* (path) {
        opened.push(path);
        const chunk = chunks.get(path);
        assert.ok(chunk, "must not open operands after rejected input");
        try { yield chunk; } finally { closed++; }
      };
    } else {
      Object.defineProperty(fs, "readStream", { value: undefined });
      context.mock.method(fs, "readFile", async (path: string, options?: Parameters<FileSystem["readFile"]>[1]) => {
        opened.push(path);
        assert.equal(options?.maxBytes, 16_000_000);
        return chunks.get(path)!;
      });
    }
    const result = await run({ fs, args: ["-o", "json", "-c", ".", "/first", "/second", "/rejected", "/unread"] });
    assert.equal(result.status, 5);
    assert.equal(result.stdout, "1\n2\n");
    assert.ok(result.stderr.includes("LIMIT_MAX_INPUT_BYTES"), result.stderr);
    assert.deepEqual(opened, ["/first", "/second", "/rejected"]);
    assert.deepEqual(copied, [first, second]);
    assert.equal(closed, streaming ? 3 : 0);
  });
}

test("yq rejects an oversized synthetic first chunk before copying and closes stdin", async context => {
  const rejected = syntheticChunk("1\n", 16_000_001);
  let copies = 0;
  let closed = 0;
  context.mock.method(globalThis, "Uint8Array", new Proxy(Uint8Array, {
    construct(target, args, newTarget) {
      if (args[0] === rejected) copies++;
      return Reflect.construct(target, args, newTarget);
    },
  }));
  const stdin: ByteSource = (async function* () {
    try { yield rejected; assert.fail("must not advance rejected input"); }
    finally { closed++; }
  })();
  const result = await run({ stdin });
  assert.equal(result.status, 5);
  assert.ok(result.stderr.includes("LIMIT_MAX_INPUT_BYTES"), result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(copies, 0);
  assert.equal(closed, 1);
});

test("yq retains owned Buffer views across producer reuse and EOF mutation", async () => {
  const stdin = (async function* () {
    const scratch = Buffer.alloc(9);
    scratch.set(Buffer.from("a: 1\n---\n"));
    yield scratch.subarray(0, 9);
    scratch.fill(0);
    scratch.set(Buffer.from("b: 2\n"));
    yield scratch.subarray(0, 5);
    scratch.fill(0x78);
  })();
  assert.deepEqual(await run({ stdin }), { status: 0, stdout: '{"a":1}\n{"b":2}\n', stderr: "" });
});

for (const [name, input, expected] of [
  ["UTF-8", '"🙂"\n', '"🙂"\n'],
  ["CRLF directives aliases and empty documents", "%YAML 1.2\r\n---\r\n[&a one, *a]\r\n...\r\n---\r\n", '["one","one"]\nnull\n'],
  ["indented scalar markers", "|-\n  ---\n  ...\n", '"---\\n..."\n'],
] as const) {
  test(`yq tiny reused one-byte producer preserves ${name}`, async () => {
    const stdin = (async function* () {
      const scratch = Buffer.alloc(1);
      for (const byte of Buffer.from(input)) { scratch[0] = byte; yield scratch; }
      scratch[0] = 0;
    })();
    assert.deepEqual(await run({ stdin }), { status: 0, stdout: expected, stderr: "" });
  });
}

test("yq malformed UTF-8 still returns its finite input diagnostic", async () => {
  const result = await run({ stdin: (async function* () { yield Uint8Array.of(0xff); })() });
  assert.equal(result.status, 5);
  assert.ok(result.stderr.includes("INPUT_INVALID_UTF8"), result.stderr);
  assert.equal(result.stdout, "");
});

for (const reason of [false, null]) {
  test(`yq cancellation retains caller reason and idempotent cleanup: ${reason}`, async () => {
    const controller = new AbortController();
    const cleanups: InvocationCleanup[] = [];
    let closed = 0;
    const stdin = (async function* () {
      try { yield Buffer.from("1\n"); controller.abort(reason); }
      finally { closed++; }
    })();
    await assert.rejects(run({ stdin, signal: controller.signal, registerCleanup: cleanup => cleanups.push(cleanup) }), failure => failure === reason);
    for (const cleanup of cleanups) { await cleanup(); await cleanup(); }
    assert.equal(cleanups.length, 1);
    assert.equal(closed, 1);
  });
}
