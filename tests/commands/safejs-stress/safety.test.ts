import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createSafeJsCommands, type SafeJsRunOptions } from "../../../src/commands/safejs/index.js";
import { contractRuntime, execute, operation } from "../safejs/helpers.js";

for (const mode of ["inline", "file", "stdin"] as const) {
  test(`fixture: ${mode} source remains exact data across source/argv boundaries`, async () => {
    const source = 'return "é😀";\n// -- -p ; $(touch /escape)';
    const args = ["", "--help", "-p", "$(touch /escape)", "'\"\n", "__proto__"];
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    await fs.writeFile("/work/-script", Buffer.from(source));
    const runtime = contractRuntime(async (received, options) => {
      assert.equal(received, source);
      assert.deepEqual(options.modules.command?.args, args);
      assert.equal(options.filename, mode === "file" ? "/work/-script" : mode === "stdin" ? "-" : "<safejs -e>");
      assert.equal(await operation(options, "stdio", "readText")(), mode === "stdin" ? "" : "guest data");
    });
    const input = mode === "stdin" ? { async *[Symbol.asyncIterator]() { for (const byte of Buffer.from(source)) yield Uint8Array.of(byte); } } : "guest data";
    const argv = mode === "inline" ? ["--eval", source, "--", ...args] : mode === "file" ? ["--", "-script", ...args] : ["-", ...args];
    const result = await execute(argv, { runtime }, input, { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["-script"]);
  });
}

for (const mode of ["inline", "file", "stdin"] as const) {
  test(`fixture: ${mode} source byte budget exact boundary includes BOM`, async () => {
    const source = "\uFEFFé😀";
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    await fs.writeFile("/work/source", Buffer.from(source));
    let calls = 0;
    const runtime = contractRuntime(async received => { calls++; assert.equal(received, "é😀"); });
    const argv = mode === "inline" ? ["-e", source] : [mode === "file" ? "source" : "-"];
    for (const maxSourceBytes of [8, 9]) {
      const result = await execute(argv, { runtime, limits: { maxSourceBytes } }, source, { fs });
      assert.equal(result.exitCode, maxSourceBytes === 9 ? 0 : 124, result.stderr);
    }
    assert.equal(calls, 1);
  });
}

test("fixture: prototype keys survive snapshots and JSON without invoking accessors", async () => {
  const env = Object.fromEntries([["__proto__", "literal"], ["constructor", "ctor"], ["prototype", "proto"]]);
  const result = await execute(["-p", "-e", "fixture"], { runtime: contractRuntime(async (_source, options) => {
    assert.deepEqual(options.modules.command?.env, Object.assign(Object.create(null), env));
    return Object.fromEntries([["__proto__", { value: "ordinary data" }], ["constructor", "ctor"]]);
  }) }, "", { env });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), '{"__proto__":{"value":"ordinary data"},"constructor":"ctor"}\n');
  assert.equal(Reflect.get(Object.prototype, "value"), undefined);
});

test("fixture: malformed runner results and error accessors fail without evaluating getters", async () => {
  let invoked = 0;
  for (const value of [null, [], { ok: "true" }, { get ok() { invoked++; return true; } },
    { ok: false, error: { get message() { invoked++; return "unsafe"; } } }]) {
    const runtime = { ...contractRuntime(async () => undefined), async run() { return value as never; } };
    const result = await execute(["-p", "-e", "fixture"], { runtime });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
  }
  assert.equal(invoked, 0);
});

test("fixture: partial UTF-8 rejects text decoding but leaves raw bytes available", async () => {
  for (const decode of [false, true]) {
    const result = await execute(["-p", "-e", "fixture"], { runtime: contractRuntime(async (_source, options) => {
      assert.deepEqual(await operation(options, "stdio", "readBytes")(1), [0xf0]);
      return await operation(options, "stdio", decode ? "readText" : "readBytes")();
    }) }, Buffer.from("😀"));
    assert.equal(result.exitCode, decode ? 1 : 0, result.stderr);
    if (!decode) assert.equal(result.stdout.toString(), "[159,152,128]\n");
  }
});

test("fixture: all engine budgets are forwarded exactly and mutable budgets are never reused", async () => {
  const seen = new Set<object>();
  const runtime = contractRuntime(async (_source, options) => {
    assert(!seen.has(options.budget)); seen.add(options.budget);
    assert.deepEqual(Object.keys(options.budget).sort(), ["arrayLength", "dataSize", "deadline", "maxCallDepth", "maxSteps", "stringLength"]);
    for (const [key, value] of Object.entries({ maxSteps: 51, maxCallDepth: 7, stringLength: 120, arrayLength: 24, dataSize: 500 })) {
      assert.equal(Reflect.get(options.budget, key), value);
    }
    assert(Reflect.get(options.budget, "deadline") > Date.now());
  });
  for (let index = 0; index < 3; index++) {
    const result = await execute(["-e", "fixture"], { runtime, limits: { maxSteps: 51, maxCallDepth: 7, stringLength: 120, arrayLength: 24, dataSize: 500 } });
    assert.equal(result.exitCode, 0, result.stderr);
  }
  assert.equal(seen.size, 3);
});

test("fixture: captured host operations cannot be reused after command completion", async () => {
  let captured: SafeJsRunOptions<object> | undefined;
  const runtime = contractRuntime(async (_source, options) => { captured = options; });
  const result = await execute(["-e", "fixture"], { runtime });
  assert.equal(result.exitCode, 0, result.stderr);
  assert(captured);
  for (const [name, args] of [["readText", []], ["readBytes", [1]], ["write", ["late"]], ["writeBytes", [[1]]], ["error", ["late"]]] as const) {
    await assert.rejects(async () => operation(captured!, "stdio", name)(...args));
  }
  assert.throws(() => operation(captured!, "command", "setExitCode")(3));
  assert.throws(() => captured!.sink.log("late"));
  assert.equal(result.stdout.length, 0);
  assert.equal(result.stderr, "");
});

test("fixture: registration configuration rejects unknown budgets", () => {
  assert.throws(() => createSafeJsCommands({ limits: { actions: 1 } as never }), /Unknown SafeJS limit: actions/u);
});

test("fixture: stdout/stderr/return share an exact cumulative UTF-8 byte budget", async () => {
  for (const maxOutputBytes of [9, 10]) {
    const runtime = contractRuntime(async (_source, options) => {
      await operation(options, "stdio", "write")("é");
      await operation(options, "stdio", "errorBytes")([0, 255, 128]);
      return "😀";
    });
    const result = await execute(["-p", "-e", "fixture"], { runtime, limits: { maxOutputBytes } });
    assert.equal(result.exitCode, maxOutputBytes === 10 ? 0 : 124, result.stderr);
    assert.equal(result.stdout.toString(), maxOutputBytes === 10 ? "é😀\n" : "é");
    if (maxOutputBytes === 9) assert.match(result.stderr, /maxOutputBytes/u);
  }
});

test("fixture: fragmented binary reads preserve bytes with varying requested sizes", async () => {
  const bytes = Buffer.from(Array.from({ length: 8193 }, (_, index) => (index * 73) & 255));
  const input = { async *[Symbol.asyncIterator]() {
    for (let offset = 0; offset < bytes.length; offset += 37) yield bytes.subarray(offset, offset + 37);
  } };
  const runtime = contractRuntime(async (_source, options) => {
    let count = 0;
    for (;;) {
      const chunk = await operation(options, "stdio", "readBytes")(1 + (count++ % 79));
      if (chunk === null) break;
      await operation(options, "stdio", "writeBytes")(chunk);
    }
    assert.equal(await operation(options, "stdio", "readText")(), "");
  });
  const result = await execute(["-e", "fixture"], { runtime, limits: { maxInputBytes: bytes.length, maxOutputBytes: bytes.length } }, input);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout, bytes);
});
