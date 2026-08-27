import assert from "node:assert/strict";
import test from "node:test";
import { FsError, Shell, standardCommands } from "../../src/index.js";
import { bufferLimit } from "../../src/commands/internal.js";
import { chunks, fixture, run } from "./helpers.js";

for (const kind of ["Buffer", "Uint8Array"] as const) {
  for (const [command, args, expected] of [
    ["tail", ["-c", "4"], [195, 169, 65, 10]],
    ["tail", ["-n", "1"], [0, 255, 195, 169, 65, 10]],
    ["head", ["-c", "-2"], [0, 255, 195, 169]],
  ] as const) {
    test(`${command} ${args.join(" ")} owns borrowed ${kind} readStream windows`, async () => {
      const fs = await fixture({ input: "fixture" });
      const controller = new AbortController();
      const backing = kind === "Buffer" ? Buffer.alloc(11, 0x7e) : new Uint8Array(11).fill(0x7e);
      const window = backing.subarray(4, 7);
      let finalized = false;
      fs.readStream = async function* (path, options) {
        assert.equal(path, "/work/input");
        assert.equal(options?.signal, controller.signal);
        try {
          for (const payload of [[0, 255, 195], [169, 65, 10]]) {
            yield window.subarray(0, 0);
            window.set(payload);
            yield window;
            assert.deepEqual([...window], payload);
          }
        } finally {
          window.fill(0);
          assert.equal(backing[3], 0x7e);
          assert.equal(backing[7], 0x7e);
          finalized = true;
        }
      };
      const result = await run(command, [...args, "input"], { fs, signal: controller.signal });
      assert.deepEqual(result.stdoutBytes, Buffer.from(expected));
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(finalized, true);
    });
  }
}

test("tail preserves its retained byte limit and finalizes the source", async () => {
  const bytes = Buffer.alloc(bufferLimit + 1, 65);
  let finalized = false;
  const stdin = (async function* () {
    try { yield bytes; }
    finally { assert.equal(bytes.every(byte => byte === 65), true); finalized = true; }
  })();
  const result = await run("tail", ["-c", String(bufferLimit + 1)], { stdin });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "tail: EFBIG: tail buffer limit exceeded\n");
  assert.equal(finalized, true);
});

for (const action of ["accept", "cancel", "reject"] as const) {
  test(`head byte omission awaits sink ${action} before another borrowed read`, { timeout: 10_000 }, async context => {
    const fs = await fixture({ input: "fixture" });
    const events: string[] = [];
    const window = Buffer.alloc(9).subarray(3, 6);
    fs.readStream = async function* () {
      try {
        for (const payload of [[65, 66, 67], [68, 69, 70]]) {
          window.set(payload);
          events.push(`yield:${payload[0]}`);
          yield window;
          events.push("next");
        }
      } finally { window.fill(0); events.push("finally"); }
    };
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const shell = new Shell({ fs }).use(standardCommands());
    context.after(async () => { release(); await shell.dispose(); });
    const controller = new AbortController();
    const reason = new FsError("EIO", { message: "sink stopped" });
    let writes = 0;
    const execution = shell.exec("head -c -2 /work/input", {
      signal: controller.signal,
      stdout: { async write(bytes) {
        if (writes++ === 0) {
          assert.deepEqual([...bytes], [65]);
          enter();
          await released;
          if (action === "reject") throw reason;
          if (action === "accept") assert.deepEqual([...bytes], [65]);
        }
      } },
    });
    const outcome = action === "cancel" ? assert.rejects(execution, error => error === reason) : execution;
    await entered;
    assert.deepEqual(events, ["yield:65"]);
    if (action === "cancel") controller.abort(reason);
    release();
    await outcome;
    if (action !== "cancel") {
      const result = await execution;
      assert.equal(result.exitCode, action === "accept" ? 0 : 1);
      assert.equal(result.stderr, action === "accept" ? "" : "head: EIO: sink stopped\n");
      if (action === "accept") assert.deepEqual([...result.stdoutBytes], [65, 66, 67, 68]);
    }
    assert.deepEqual(events, action === "accept"
      ? ["yield:65", "next", "yield:68", "next", "finally"]
      : ["yield:65", "finally"]);
  });
}

test("cat copies binary chunks, preserves missing final newlines and consumes stdin only once", async () => {
  const fs = await fixture({ before: "before\n", after: "after" });
  const result = await run("cat", ["before", "-", "after", "-"], { fs, stdin: chunks(new Uint8Array([0, 255, 10])) });
  assert.deepEqual(result.stdoutBytes, Buffer.concat([Buffer.from("before\n"), Buffer.from([0, 255, 10]), Buffer.from("after")]));
  assert.equal((await run("cat", ["missing", "after"], { fs })).stdout, "after");
  assert.equal((await run("cat", ["missing", "after"], { fs })).exitCode, 1);
});

test("cat numbering, blank squeezing and visible bytes survive chunk boundaries", async () => {
  assert.equal((await run("cat", ["-ns"], { stdin: chunks("a\n\n\nb\n") })).stdout, "     1\ta\n     2\t\n     3\tb\n");
  assert.equal((await run("cat", ["-bn"], { stdin: chunks("\na\n") })).stdout, "\n     1\ta\n");
  assert.equal((await run("cat", ["-A"], { stdin: chunks(new Uint8Array([0, 9, 127, 255, 10])) })).stdout, "^@^I^?M-^?$\n");
  const fs = await fixture({ first: "a", second: "b\n" });
  assert.equal((await run("cat", ["-n", "first", "second"], { fs })).stdout, "     1\tab\n");
});

test("head and tail support byte/line counts, origin counts, omission and unterminated lines", async () => {
  const stdin = "one\ntwo\nthree";
  assert.equal((await run("head", ["-n", "2"], { stdin: chunks(stdin) })).stdout, "one\ntwo\n");
  assert.equal((await run("head", ["-n", "-1"], { stdin: chunks(stdin) })).stdout, "one\ntwo\n");
  assert.equal((await run("head", ["-c", "3"], { stdin: chunks(stdin) })).stdout, "one");
  assert.equal((await run("head", ["-c", "-3"], { stdin: chunks(stdin, 5) })).stdout, "one\ntwo\nth");
  assert.equal((await run("tail", ["-n", "2"], { stdin: chunks(stdin) })).stdout, "two\nthree");
  assert.equal((await run("tail", ["-n", "+2"], { stdin: chunks(stdin, 6) })).stdout, "two\nthree");
  assert.equal((await run("tail", ["-c", "3"], { stdin: chunks(stdin, 4) })).stdout, "ree");
  assert.equal((await run("tail", ["-c", "+5"], { stdin: chunks(stdin, 4) })).stdout, "two\nthree");
  assert.equal((await run("tail", ["-n", "0"], { stdin })).stdout, "");
  assert.equal((await run("head", ["-n", "nope"], { stdin })).exitCode, 2);
});

test("head stops reading when satisfied and multiple input headers are controllable", async () => {
  let reads = 0;
  const source = (async function* () { reads++; yield Buffer.from("first\n"); reads++; yield Buffer.from("second\n"); })();
  assert.equal((await run("head", ["-n", "1"], { stdin: source })).stdout, "first\n");
  assert.equal(reads, 1);
  const fs = await fixture({ first: "one\n", second: "two\n" });
  assert.equal((await run("head", ["first", "second"], { fs })).stdout, "==> first <==\none\n\n==> second <==\ntwo\n");
  assert.equal((await run("tail", ["-q", "first", "second"], { fs })).stdout, "one\ntwo\n");
});

test("wc tracks words across chunks and distinguishes bytes, UTF-8 characters and newlines", async () => {
  const result = await run("wc", ["-lwcm"], { stdin: chunks("héllo  world\nlast") });
  assert.equal(result.stdout, "      1       3      17      18\n");
  assert.equal((await run("wc", ["-c"], { stdin: new Uint8Array([0, 255, 1]) })).stdout, "3\n");
  const fs = await fixture({ first: "a\n", second: "b\nc\n" });
  assert.equal((await run("wc", ["-l", "first", "second"], { fs })).stdout, "1 first\n2 second\n3 total\n");
});

test("tee streams to stdout and multiple virtual files, supports append, and continues after file errors", async () => {
  const fs = await fixture({ existing: "old" });
  const result = await run("tee", ["existing", "new", "missing/child"], { fs, stdin: chunks(new Uint8Array([0, 255, 10])) });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stdoutBytes, Buffer.from([0, 255, 10]));
  assert.deepEqual(await fs.readFile("/work/existing"), new Uint8Array([0, 255, 10]));
  assert.deepEqual(await fs.readFile("/work/new"), new Uint8Array([0, 255, 10]));
  assert.equal((await run("tee", ["-a", "new"], { fs, stdin: "tail" })).exitCode, 0);
  assert.deepEqual(await fs.readFile("/work/new"), new Uint8Array([0, 255, 10, 116, 97, 105, 108]));
});

test("tr translates, deletes, squeezes and complements byte sets across chunks", async () => {
  assert.equal((await run("tr", ["a-z", "A-Z"], { stdin: chunks("one two\n") })).stdout, "ONE TWO\n");
  assert.equal((await run("tr", ["-s", "[:space:]", " "], { stdin: chunks("a \t\n b") })).stdout, "a b");
  assert.equal((await run("tr", ["-d", "[:digit:]"], { stdin: chunks("a1b2") })).stdout, "ab");
  assert.equal((await run("tr", ["-cd", "[:digit:]"], { stdin: chunks("a1b2\n") })).stdout, "12");
  assert.equal((await run("tr", ["-ds", "x", "a"], { stdin: chunks("aaxaa") })).stdout, "a");
  assert.equal((await run("tr", ["abc", "x"], { stdin: "abc" })).stdout, "xxx");
  assert.deepEqual((await run("tr", ["\\000", "\\377"], { stdin: new Uint8Array([0, 1]) })).stdoutBytes, Buffer.from([255, 1]));
  assert.equal((await run("tr", ["z-a", "x"])).exitCode, 2);
  assert.equal((await run("tr", ["a", ""])).exitCode, 2);
});
