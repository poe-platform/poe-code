import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createMikeYqCommand } from "./mike.js";

for (const file of [false, true]) for (const stop of ["none", "abort", "sink"] as const) {
  test(`JSON input respects document backpressure and ownership: file=${file}, stop=${stop}`, async () => {
    const controller = new AbortController(), failure = new Error("stop");
    let produced = 0, consumed = 0, closed = 0, diagnostic = "";
    const count = 128, encoder = new TextEncoder();
    const source = { async *[Symbol.asyncIterator]() {
      const reused = new Uint8Array(32);
      try {
        for (let index = 0; index < count; index++) {
          assert.equal(produced, consumed, "must finish output before requesting the next document");
          const bytes = encoder.encode(JSON.stringify({ n: index, text: "é😀" }) + "\n");
          reused.set(bytes);
          produced++;
          yield reused.subarray(0, bytes.length);
        }
      } finally { closed++; }
    } };
    const fs = createMemoryFileSystem();
    const injected = new Proxy(fs, { get(target, key) {
      if (key === "readFile") return () => assert.fail("input must not use readFile");
      if (key === "readStream") return () => source;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = Promise.resolve(createMikeYqCommand().execute({ command: "yq",
      ...createCommandArguments(["-p=json", "-o=json", "-I=0", ".n", ...(file ? ["/input.json"] : [])]),
      cwd: "/", env: {}, fs: injected, signal: controller.signal,
      stdin: source,
      stdout: { async write(bytes) {
        await Promise.resolve();
        assert.equal(new TextDecoder().decode(bytes), `${consumed}\n`);
        consumed++;
        if (stop === "abort") controller.abort(failure);
        if (stop === "sink") throw failure;
      } },
      stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } },
    }));
    if (stop === "none") {
      assert.equal((await result).exitCode, 0, diagnostic);
      assert.equal(consumed, count);
    } else {
      await assert.rejects(result, error => error === failure);
      assert.equal(produced, 1);
    }
    assert.equal(closed, 1);
  });
}

for (const width of [1, 2, 7, 4096]) test(`JSON framing preserves UTF-8, escapes and document indices at ${width} bytes`, async () => {
  const input = new TextEncoder().encode(' {"a":["é😀", "a\\"b", {"x":true}]}\n"scalar" null 12.5e2 [false]\n');
  let output = "", diagnostic = "";
  const result = await createMikeYqCommand().execute({ command: "yq",
    ...createCommandArguments(["-p=json", "-o=json", "-I=0", "[documentIndex, .]"]), cwd: "/", env: {},
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {
      const reused = new Uint8Array(width);
      for (let offset = 0; offset < input.length; offset += width) {
        const chunk = input.subarray(offset, offset + width); reused.set(chunk);
        yield reused.subarray(0, chunk.length);
      }
    } },
    stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 0, diagnostic);
  assert.equal(output, '[0,{"a":["é😀","a\\"b",{"x":true}]}]\n[1,"scalar"]\n[2,null]\n[3,1250]\n[4,[false]]\n');
});

for (const ending of [new Uint8Array([0xc3]), new TextEncoder().encode('{"bad":')]) test(`JSON reports malformed trailing input after completed output (${ending[0]})`, async () => {
  let output = "", diagnostic = "", closed = false;
  const result = await createMikeYqCommand().execute({ command: "yq",
    ...createCommandArguments(["-p=json", "-o=json", "-I=0", "."]), cwd: "/", env: {},
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { try { yield new TextEncoder().encode("42\n"); yield ending; } finally { closed = true; } } },
    stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(output, "42\n");
  assert.ok(diagnostic.includes(ending[0] === 0xc3 ? "invalid UTF-8" : "unexpected end of JSON input"), diagnostic);
  assert.equal(closed, true);
});

for (const mode of ["eval", "eval-all"]) test(`JSON ${mode} preserves multi-document evaluation`, async () => {
  let output = "";
  const result = await createMikeYqCommand().execute({ command: "yq",
    ...createCommandArguments([mode, "-p=json", "-o=json", "-I=0", mode === "eval" ? "documentIndex" : "[.] | length"]),
    cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode("1\n2\n3\n"); } },
    stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } }, stderr: { async write() {} },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(output, mode === "eval" ? "0\n1\n2\n" : "3\n");
});

test("JSON streaming preserves source failure identity and closes its iterator", async () => {
  const failure = new Error("source failed");
  let closed = false, writes = 0;
  await assert.rejects(async () => createMikeYqCommand().execute({ command: "yq",
    ...createCommandArguments(["-p=json", "."]), cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { try { yield new TextEncoder().encode("1\n"); throw failure; } finally { closed = true; } } },
    stdout: { async write() { writes++; } }, stderr: { async write() {} },
  }), error => error === failure);
  assert.equal(writes, 1);
  assert.equal(closed, true);
});

test("JSON in-place parsing failure preserves the original file", async () => {
  const fs = createMemoryFileSystem(), input = new TextEncoder().encode('{"n":1}\n{"n":');
  await fs.writeFile("/input.json", input);
  const result = await createMikeYqCommand().execute({ command: "yq",
    ...createCommandArguments(["-i", ".n = 2", "/input.json"]), cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() { assert.fail("in-place writes must stay staged"); } }, stderr: { async write() {} },
  });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(await fs.readFile("/input.json"), input);
});
