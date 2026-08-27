import assert from "node:assert/strict";
import { test } from "node:test";
import { type ByteSource } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run } from "./helpers.js";

function programFile(source: ByteSource, signal?: AbortSignal): MemoryFileSystem {
  const fs = new MemoryFileSystem();
  fs.readStream = (path, options) => {
    assert.equal(path, "/filter.jq");
    if (signal) assert.equal(options?.signal, signal);
    return source;
  };
  return fs;
}

for (const kind of ["Buffer", "Uint8Array"] as const) {
  test(`jq -f owns ragged offset ${kind} chunks before producer reuse`, async () => {
    const backing = kind === "Buffer" ? Buffer.alloc(24, 0x7e) : new Uint8Array(24).fill(0x7e);
    const program = Buffer.from('"é" + "!"');
    let closed = false;
    let offset = 0;
    const source = (async function* (): ByteSource {
      try {
        for (const length of [2, 0, 1, 4, 3]) {
          backing.fill(0x7e);
          backing.set(program.subarray(offset, offset + length), 5);
          const expected = Uint8Array.from(backing);
          yield backing.subarray(5, 5 + length);
          assert.deepEqual(Uint8Array.from(backing), expected);
          offset += length;
        }
      } finally { backing.fill(0x78); closed = true; }
    })();
    const result = await run(["-nr", "-f", "/filter.jq"], "", {}, { fs: programFile(source) });
    assert.equal(closed, true);
    assert.equal(offset, program.length);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "é!\n");
  });

  test(`jq -f owns a final ${kind} view before producer finalization`, async () => {
    const backing = kind === "Buffer" ? Buffer.from("xx42yy") : Uint8Array.from(Buffer.from("xx42yy"));
    let closed = false;
    const source = (async function* (): ByteSource {
      try { yield backing.subarray(2, 4); }
      finally { backing.fill(0x30); closed = true; }
    })();
    const result = await run(["-nc", "-f", "/filter.jq"], "", {}, { fs: programFile(source) });
    assert.equal(closed, true);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "42\n");
  });
}

test("jq -f leaves stable offset Buffer input and sentinels unchanged", async () => {
  const backing = Buffer.from("prefix. + 2suffix");
  const expected = Buffer.from(backing);
  const source = (async function* (): ByteSource { yield backing.subarray(6, 11); })();
  const result = await run(["-c", "-f", "/filter.jq"], "3", {}, { fs: programFile(source) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "5\n");
  assert.deepEqual(backing, expected);
});

test("jq -f rejects original invalid UTF-8 even when finalizer replaces it with valid text", async () => {
  const backing = Buffer.from([0x22, 0xff, 0x22]);
  const source = (async function* (): ByteSource {
    try { yield backing; } finally { backing.set(Buffer.from('"x"')); }
  })();
  const result = await run(["-nc", "-f", "/filter.jq"], "", {}, { fs: programFile(source) });
  assert.equal(result.exitCode, 3);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /program file is not valid UTF-8/);
});

test("jq -f preserves exact source-byte limit and closes rejected input", async () => {
  for (const maximum of [4, 3]) {
    let closed = false;
    const backing = Buffer.from("42  ");
    const source = (async function* (): ByteSource {
      try { yield backing.subarray(0, 2); yield backing.subarray(2); }
      finally { closed = true; }
    })();
    const result = await run(["-nc", "-f", "/filter.jq"], "", { limits: { maxSourceBytes: maximum } }, { fs: programFile(source) });
    assert.equal(closed, true);
    assert.equal(result.exitCode, maximum === 4 ? 0 : 5, result.stderr);
    assert.equal(result.stdout, maximum === 4 ? "42\n" : "");
    if (maximum === 3) assert.match(result.stderr, /maxSourceBytes/);
  }
});

test("jq -f does not relax the independent input-byte limit", async () => {
  const source = (async function* (): ByteSource { yield Buffer.from("."); })();
  const result = await run(["-c", "-f", "/filter.jq"], JSON.stringify("x".repeat(40)),
    { limits: { maxInputBytes: 32 } }, { fs: programFile(source) });
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /maxInputBytes/);
});

test("jq -f forwards cancellation while closing retained source storage", async () => {
  const controller = new AbortController();
  const reason = new Error("stop program read");
  const backing = Buffer.from("42");
  let closed = false;
  let writes = 0;
  const source = (async function* (): ByteSource {
    try { yield backing; controller.abort(reason); yield backing.subarray(0, 0); }
    finally { backing.fill(0); closed = true; }
  })();
  await assert.rejects(run(["-nc", "-f", "/filter.jq"], "", {}, {
    fs: programFile(source, controller.signal), signal: controller.signal,
    stdout: { async write() { writes++; } }, stderr: { async write() { writes++; } },
  }), error => error === reason);
  assert.equal(closed, true);
  assert.equal(writes, 0);
});
