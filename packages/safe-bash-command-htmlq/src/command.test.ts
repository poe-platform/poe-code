import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCommandArguments,
  CommandRegistry,
  type CommandContext
} from "safe-bash-contracts/command";
import { shellValueFromBytes } from "safe-bash-contracts/value";
import { FsError } from "safe-bash-contracts/errors";
import { createHtmlqCommand, htmlq, htmlqCommands } from "./index.js";
function fixture(argv: readonly string[], input = "<p>X</p>") {
  const carrier = createCommandArguments(argv),
    output: Uint8Array[] = [],
    errors: Uint8Array[] = [],
    cleanups: (() => void | Promise<void>)[] = [];
  const files = new Map([["/vfs/in", new TextEncoder().encode(input)]]);
  const stat = { type: "file", size: 0, ino: 1, dev: 1 };
  const context = {
    command: "htmlq",
    args: carrier.args,
    argumentValues: carrier,
    cwd: "/vfs",
    env: {},
    signal: new AbortController().signal,
    stdin: (async function* () {
      yield new TextEncoder().encode(input);
    })(),
    stdout: {
      async write(bytes: Uint8Array) {
        output.push(bytes.slice());
      }
    },
    stderr: {
      async write(bytes: Uint8Array) {
        errors.push(bytes.slice());
      }
    },
    registerCleanup(fn: () => void | Promise<void>) {
      cleanups.push(fn);
    },
    fs: {
      capabilities: { atomicFilePublication: true },
      readStream(path: string) {
        return (async function* () {
          const b = files.get(path);
          if (!b) throw new FsError("ENOENT");
          yield b;
        })();
      },
      async lstat(path: string) {
        if (!files.has(path)) throw new FsError("ENOENT");
        return stat;
      },
      async stat() {
        return { ...stat, type: "directory" };
      },
      async publishFileConditional(path: string, source: AsyncIterable<Uint8Array>) {
        const chunks: number[] = [];
        for await (const bytes of source) chunks.push(...bytes);
        files.set(path, Uint8Array.from(chunks));
        return stat;
      }
    }
  } as unknown as CommandContext;
  return {
    context,
    files,
    output,
    errors,
    cleanups,
    text: () => output.map((b) => new TextDecoder().decode(b)).join("")
  };
}
test("pretty CLI and SDK preserve htmlq 0.5.0 spacing after block void elements", async () => {
  for (const [input, expected] of [
    ['<head><base href="/"><title>T</title></head>', '\n<html>\n  <head>\n    <base href="/">\n    \n    <title>\n      T\n    </title>\n  </head>\n  <body>\n  </body>\n</html>\n'],
    ['<p>a<br>b</p>', '\n<html>\n  <head>\n  </head>\n  <body>\n    <p>\n      a\n      <br>\n      \n      b\n    </p>\n  </body>\n</html>\n'],
    ['<p>a<img src="x">b</p>', '\n<html>\n  <head>\n  </head>\n  <body>\n    <p>\n      a<img src="x">b\n    </p>\n  </body>\n</html>\n']
  ]) {
    const cli = fixture(["html", "-p", "-f", "in"], input);
    const sdk = fixture([], input);
    assert.equal((await createHtmlqCommand().execute(cli.context)).exitCode, 0);
    assert.equal((await htmlq(sdk.context, { selector: "html", pretty: true, filename: "in" })).exitCode, 0);
    assert.equal(cli.text(), expected);
    assert.deepEqual(cli.output, sdk.output);
    assert.deepEqual(cli.errors, []);
    assert.deepEqual(sdk.errors, []);
    await Promise.all([...cli.cleanups, ...sdk.cleanups].map((fn) => fn()));
  }
});
test("CLI and SDK share argv validation and projection, opt-in registration", async () => {
  const cli = fixture(["p", "-t"]),
    sdk = fixture([]);
  assert.equal((await createHtmlqCommand().execute(cli.context)).exitCode, 0);
  assert.equal((await htmlq(sdk.context, { argv: ["p", "-t"] })).exitCode, 0);
  assert.equal(cli.text(), "X\n");
  assert.deepEqual(cli.output, sdk.output);
  const registry = new CommandRegistry();
  htmlqCommands().setup({ commands: registry } as never);
  assert.ok(registry.get("htmlq"));
  await Promise.all(cli.cleanups.map((fn) => fn()));
});
test("CLI and SDK preserve CSS CRLF escapes and reject unescaped newlines", async () => {
  for (const selector of ['[title="a\\\r\nb"]', "#\\61\r\nb", '[title="a\r\nb"]']) {
    const argv = [selector, "-t"];
    const input = '<p id="ab" title="ab">joined</p>';
    const cli = fixture(argv, input),
      sdk = fixture([], input);
    const cliResult = await createHtmlqCommand().execute(cli.context);
    const sdkResult = await htmlq(sdk.context, { argv });
    assert.equal(cliResult.exitCode, selector.includes("a\r\nb") ? 1 : 0);
    assert.equal(sdkResult.exitCode, cliResult.exitCode);
    assert.deepEqual(cli.output, sdk.output);
    assert.deepEqual(cli.errors, sdk.errors);
    assert.equal(cli.text(), cliResult.exitCode === 0 ? "joined\n" : "");
    await Promise.all([...cli.cleanups, ...sdk.cleanups].map((fn) => fn()));
  }
});
test("VFS same input/output reads fully before protected publication; failed query preserves file", async () => {
  const f = fixture(["p", "-t", "-f", "in", "-o", "in"]);
  assert.equal((await createHtmlqCommand().execute(f.context)).exitCode, 0);
  assert.equal(new TextDecoder().decode(f.files.get("/vfs/in")), "X\n");
  assert.equal(f.output.length, 0);
  const bad = fixture(["[", "-f", "in", "-o", "in"]);
  assert.equal((await createHtmlqCommand().execute(bad.context)).exitCode, 1);
  assert.equal(new TextDecoder().decode(bad.files.get("/vfs/in")), "<p>X</p>");
});
test("closed sinks and cleanup failures are observed", async () => {
  const f = fixture(["p"]);
  const failure = new Error("sink closed");
  const context = {
    ...f.context,
    stdout: {
      async write() {
        throw failure;
      }
    }
  };
  await assert.rejects(
    async () => await createHtmlqCommand().execute(context),
    (e: unknown) => e === failure
  );
  const invalid = fixture(["--tex"]);
  assert.equal((await createHtmlqCommand().execute(invalid.context)).exitCode, 2);
  assert.equal(invalid.text(), "");
});
test("limits only lower ceilings; cancellation releases pending source once", async () => {
  assert.throws(() => createHtmlqCommand({ limits: { inputBytes: Number.MAX_SAFE_INTEGER } }));
  const f = fixture(["p"]),
    controller = new AbortController();
  let returned = 0;
  const source = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          controller.abort();
          return new Promise<IteratorResult<Uint8Array>>(() => {});
        },
        async return() {
          returned++;
          return { done: true as const, value: undefined };
        }
      };
    }
  };
  await assert.rejects(
    async () =>
      await createHtmlqCommand().execute({ ...f.context, signal: controller.signal, stdin: source })
  );
  assert.equal(returned, 1);
  await Promise.all(f.cleanups.map((fn) => fn()));
});
test("exhausted output and work budgets return structured failure without unaccounted diagnostics", async () => {
  const f = fixture(["p", "-t"], "<p>A</p><p>B</p>");
  const result = await htmlq(f.context, { limits: { outputBytes: 3 } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.error?.code, "E_LIMIT");
  assert.equal(result.accounting.outputBytes, 3);
  assert.equal(f.errors.length, 0);
  assert.ok(result.accounting.inputBytes > 0);
  assert.ok(result.accounting.decodedBytes > 0);
  const work = fixture(["p"]);
  const limited = await htmlq(work.context, { limits: { work: 0 } });
  assert.equal(limited.exitCode, 1);
  assert.equal(limited.accounting.work, 0);
  assert.equal(work.errors.length, 0);
});
test("parent input budgets remain enforced and byte argv cannot collapse invalid UTF8", async () => {
  const f = fixture(["p"]);
  const failure = new Error("host input ceiling");
  await assert.rejects(
    async () =>
      await createHtmlqCommand().execute({
        ...f.context,
        inputBudget: {
          maxBytes: 1,
          check() {
            throw failure;
          }
        }
      }),
    (e) => e === failure
  );
  const invalid = fixture([]),
    carrier = createCommandArguments([shellValueFromBytes(Uint8Array.of(255))]);
  const result = await createHtmlqCommand().execute({
    ...invalid.context,
    args: carrier.args,
    argumentValues: carrier
  });
  assert.equal(result.exitCode, 2);
  assert.equal(invalid.text(), "");
});
test("output consumer closure cancels pending input and awaits its cleanup", async () => {
  const f = fixture(["p"]),
    consumer = new AbortController();
  let returned = 0;
  const source = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          consumer.abort(new Error("consumer closed"));
          return new Promise<IteratorResult<Uint8Array>>(() => {});
        },
        async return() {
          returned++;
          return { done: true as const, value: undefined };
        }
      };
    }
  };
  const sink = {
    async write() {},
    ownedOutput: { consumerClosed: consumer.signal, async write() {} }
  };
  const running = createHtmlqCommand().execute({ ...f.context, stdin: source, stdout: sink });
  const ended = await Promise.race([
    Promise.resolve(running).then(
      () => "resolved",
      () => "rejected"
    ),
    new Promise<string>((resolve) => setImmediate(() => resolve("pending")))
  ]);
  assert.equal(ended, "rejected");
  assert.equal(returned, 1);
});
test("command source admission preserves cross-realm bytes and cancellation cleanup failures", async () => {
  const { runInNewContext } = await import("node:vm");
  const f = fixture(["p", "-t"]);
  const bytes = runInNewContext("Uint8Array.of(60,112,62,88,60,47,112,62)") as Uint8Array;
  assert.equal(
    (
      await createHtmlqCommand().execute({
        ...f.context,
        stdin: (async function* () {
          yield bytes;
        })()
      })
    ).exitCode,
    0
  );
  assert.equal(f.text(), "X\n");
  const cancelled = fixture(["p"]),
    controller = new AbortController();
  const source = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          controller.abort();
          return new Promise<IteratorResult<Uint8Array>>(() => {});
        },
        async return(): Promise<IteratorResult<Uint8Array>> {
          throw 0;
        }
      };
    }
  };
  await assert.rejects(
    async () =>
      await createHtmlqCommand().execute({
        ...cancelled.context,
        stdin: source,
        signal: controller.signal
      }),
    (error: unknown) => error instanceof AggregateError && error.errors[1] === 0
  );
});
test("late read completion cannot call parent budgets after invocation cleanup", async () => {
  const f = fixture(["p"]),
    controller = new AbortController();
  let resolve!: (result: IteratorResult<Uint8Array>) => void,
    checks = 0;
  const source = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          controller.abort();
          return new Promise<IteratorResult<Uint8Array>>((complete) => {
            resolve = complete;
          });
        },
        async return() {
          return { done: true as const, value: undefined };
        }
      };
    }
  };
  await assert.rejects(
    async () =>
      await createHtmlqCommand().execute({
        ...f.context,
        stdin: source,
        signal: controller.signal,
        inputBudget: {
          maxBytes: 100,
          check() {
            checks++;
          }
        }
      })
  );
  resolve({ done: false, value: new TextEncoder().encode("<p>X</p>") });
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(checks, 0);
});
test("atomic byte-write VFS supports output with bounded spooling and preserves failed projections", async () => {
  const f = fixture(["p", "-t", "-f", "in", "-o", "in"]);
  const fs = {
    ...f.context.fs,
    capabilities: { atomicFileMutation: true },
    async writeFileConditional(path: string, data: Uint8Array) {
      const stat = await f.context.fs.lstat(path);
      f.files.set(path, data.slice());
      return stat;
    }
  };
  Reflect.deleteProperty(fs, "publishFileConditional");
  assert.equal((await createHtmlqCommand().execute({ ...f.context, fs })).exitCode, 0);
  assert.equal(new TextDecoder().decode(f.files.get("/vfs/in")), "X\n");
  const old = new TextEncoder().encode("<p>X</p>");
  f.files.set("/vfs/in", old);
  const carrier = createCommandArguments(["[", "-f", "in", "-o", "in"]);
  assert.equal(
    (
      await createHtmlqCommand().execute({
        ...f.context,
        fs,
        args: carrier.args,
        argumentValues: carrier
      })
    ).exitCode,
    1
  );
  assert.deepEqual(f.files.get("/vfs/in"), old);
});
test("grouped and attached options preserve CLI and typed SDK parity", async () => {
  const input = '<p id="x"> <b>A</b> </p>';
  const cli = fixture(["-tipaid", "-fin", "p"], input);
  const sdk = fixture([], input);
  assert.equal((await createHtmlqCommand().execute(cli.context)).exitCode, 0);
  assert.equal(
    (
      await htmlq(sdk.context, {
        selector: "p",
        filename: "in",
        text: true,
        ignoreWhitespace: true,
        pretty: true,
        attributes: ["id"]
      })
    ).exitCode,
    0
  );
  assert.equal(cli.text(), "x\n");
  assert.deepEqual(sdk.output, cli.output);
  const text = fixture(["p", "-ti"], input);
  assert.equal((await createHtmlqCommand().execute(text.context)).exitCode, 0);
  assert.equal(text.text(), "A\n\n");
});
test("literal operands and unknown grouped flags fail consistently", async () => {
  for (const argv of [["-tx"], ["--attribute=id"], ["--tex"], ["-a"]]) {
    const f = fixture(argv);
    assert.equal((await createHtmlqCommand().execute(f.context)).exitCode, 2);
    assert.equal(new TextDecoder().decode(f.errors[0]), "htmlq: E_ARGUMENT\n");
    assert.equal(f.text(), "");
  }
  const literal = fixture(["-t", "--", "p"]);
  assert.equal((await createHtmlqCommand().execute(literal.context)).exitCode, 0);
  assert.equal(literal.text(), "X\n");
  const mixed = fixture([]);
  assert.equal((await htmlq(mixed.context, { argv: ["p"], text: true })).exitCode, 2);
});
test("nonrepeatable native options reject duplicate short and long spellings before VFS I/O", async () => {
  for (const argv of [
    ["-tt"], ["-B", "--detect-base"], ["-i", "--ignore-whitespace"],
    ["-p", "--pretty"], ["-fin", "--filename=in"],
    ["-oout", "--output=out"], ["-bhttps://a.test", "--base=https://b.test"]
  ]) {
    const cli = fixture(argv), sdk = fixture([]);
    let reads = 0;
    const fs = { ...cli.context.fs, readStream() { reads++; throw new Error("unexpected VFS read"); } };
    assert.equal((await createHtmlqCommand().execute({ ...cli.context, fs })).exitCode, 2);
    assert.equal((await htmlq({ ...sdk.context, fs }, { argv })).exitCode, 2);
    assert.equal(reads, 0);
    assert.equal(cli.text(), "");
    assert.equal(new TextDecoder().decode(cli.errors[0]), "htmlq: E_ARGUMENT\n");
    assert.deepEqual(cli.errors, sdk.errors);
  }
});
test("repeatable native attribute and removal options retain order across spellings", async () => {
  const input = '<p id="x" title="y"><b>A</b><i>B</i></p>';
  const cli = fixture(["p", "-aid", "--attributes=title", "-rb", "--remove-nodes=i"], input);
  const sdk = fixture([], input);
  assert.equal((await createHtmlqCommand().execute(cli.context)).exitCode, 0);
  assert.equal((await htmlq(sdk.context, { selector: "p", attributes: ["id", "title"], removeNodes: ["b", "i"] })).exitCode, 0);
  assert.equal(cli.text(), "x\ny\n");
  assert.deepEqual(cli.output, sdk.output);
});
test("separate option values cannot swallow flags or the operand delimiter", async () => {
  for (const argv of [["-f", "--unknown"], ["-a", "--text"], ["-r", "--"], ["--output", "-tx"]]) {
    const cli = fixture(argv), sdk = fixture([]);
    assert.equal((await createHtmlqCommand().execute(cli.context)).exitCode, 2);
    assert.equal((await htmlq(sdk.context, { argv })).exitCode, 2);
    assert.deepEqual(cli.errors, sdk.errors);
    assert.equal(new TextDecoder().decode(cli.errors[0]), "htmlq: E_ARGUMENT\n");
    assert.equal(cli.text(), "");
  }
  const cli = fixture(["p", "--filename=-input", "-t"]), sdk = fixture([]);
  for (const f of [cli, sdk]) f.files.set("/vfs/-input", new TextEncoder().encode("<p>literal</p>"));
  assert.equal((await createHtmlqCommand().execute(cli.context)).exitCode, 0);
  assert.equal((await htmlq(sdk.context, { selector: "p", filename: "-input", text: true })).exitCode, 0);
  assert.equal(cli.text(), "literal\n");
  assert.deepEqual(cli.output, sdk.output);
});
test("short value options accept equals attachment and typed SDK snapshots arrays", async () => {
  const cli = fixture(["p", "-a=id"], '<p id="x">A</p>');
  assert.equal((await createHtmlqCommand().execute(cli.context)).exitCode, 0);
  assert.equal(cli.text(), "x\n");
  const sdk = fixture([], '<p id="x">A</p>');
  const attributes = ["id"];
  const pending = htmlq(sdk.context, { selector: "p", attributes });
  attributes[0] = "missing";
  assert.equal((await pending).exitCode, 0);
  assert.equal(sdk.text(), "x\n");
});
test("typed SDK maps every option to the literal CLI VFS invocation", async () => {
  const input = '<base href="https://e.test/"><a href="child"><b>A</b>B</a>';
  const cli = fixture(
    ["a", "-fin", "-oout", "-bhttps://fallback.test/", "-B", "-rb", "-ahref"],
    input
  );
  const sdk = fixture([], input);
  assert.equal((await createHtmlqCommand().execute(cli.context)).exitCode, 0);
  assert.equal(
    (
      await htmlq(sdk.context, {
        selector: "a",
        filename: "in",
        output: "out",
        base: "https://fallback.test/",
        detectBase: true,
        removeNodes: ["b"],
        attributes: ["href"]
      })
    ).exitCode,
    0
  );
  assert.deepEqual(sdk.files, cli.files);
  assert.equal(new TextDecoder().decode(sdk.files.get("/vfs/out")), "https://e.test/child\n");
});

test("cancellation during output stops later writes and invocation cleanup is idempotent", async () => {
  const f = fixture(["p", "-t"], "<p>A</p><p>B</p>"), controller = new AbortController();
  let writes = 0;
  const context = { ...f.context, signal: controller.signal, stdout: {
    async write(bytes: Uint8Array) {
      writes++;
      f.output.push(bytes.slice());
      controller.abort(new Error("stop after admitted prefix"));
    }
  } };
  await assert.rejects(() => htmlq(context), error => error === controller.signal.reason);
  assert.equal(writes, 1);
  assert.equal(f.text(), "A");
  assert.equal(f.errors.length, 0);
  await Promise.all(f.cleanups.map(fn => fn()));
  await Promise.all(f.cleanups.map(fn => fn()));
  assert.equal(writes, 1);
});

test("unqualified output capabilities never fall back to unconditional mutation", async () => {
  for (const capabilities of [{}, { write: false, atomicFilePublication: true }, { readOnly: true, atomicFilePublication: true }]) {
    const f = fixture(["p", "-t", "-o", "in"]);
    let mutations = 0;
    const fs = { ...f.context.fs, capabilities,
      async writeFile() { mutations++; throw new Error("unconditional write denied"); },
      async rm() { mutations++; throw new Error("recursive delete denied"); }
    };
    const result = await htmlq({ ...f.context, fs });
    assert.equal(result.exitCode, 1);
    assert.equal(result.error?.code, "E_UNSUPPORTED");
    assert.equal(mutations, 0);
    assert.deepEqual(f.files.get("/vfs/in"), new TextEncoder().encode("<p>X</p>"));
    assert.equal(f.output.length, 0);
    await Promise.all(f.cleanups.map(fn => fn()));
  }
});

test("closed stdout does not cancel independent file input/output on byte-only VFS", async () => {
  const f = fixture(["p", "-t", "-f", "in", "-o", "out"]);
  const consumer = new AbortController();
  consumer.abort(new Error("stdout consumer closed"));
  const fs = { ...f.context.fs, async readFile(path: string) {
    return f.files.get(path)!.slice();
  } };
  Reflect.deleteProperty(fs, "readStream");
  const result = await htmlq({ ...f.context, fs, stdout: {
    async write() { throw new Error("unexpected stdout write"); },
    ownedOutput: { consumerClosed: consumer.signal, async write() { throw new Error("unexpected stdout write"); } }
  } });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(f.files.get("/vfs/out"), new TextEncoder().encode("X\n"));
  assert.equal(f.output.length, 0);
});

test("byte-only VFS read cancellation drains admitted read work before cleanup settles", async () => {
  const f = fixture(["p", "-t", "-f", "in", "-o", "out"]), controller = new AbortController();
  let complete!: (data: Uint8Array) => void, reading!: () => void, cleaned = false;
  const started = new Promise<void>(resolve => { reading = resolve; });
  const fs = { ...f.context.fs, async readFile(_path: string, options?: { signal?: AbortSignal }) {
    assert.equal(options?.signal?.aborted, false);
    reading();
    return new Promise<Uint8Array>(resolve => { complete = resolve; });
  } };
  Reflect.deleteProperty(fs, "readStream");
  const running = htmlq({ ...f.context, fs, signal: controller.signal });
  const ended = running.then(() => { cleaned = true; }, () => { cleaned = true; });
  await started;
  controller.abort();
  const closing = Promise.resolve(f.cleanups[0]!());
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(cleaned, false);
  complete(new TextEncoder().encode("<p>late</p>"));
  await assert.rejects(() => running, { code: "E_CANCELLED" });
  await Promise.all([ended, closing]);
  assert.equal(cleaned, true);
  assert.equal(f.files.has("/vfs/out"), false);
  assert.equal(f.output.length, 0);
});
