import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createCommandArguments } from "safe-bash-contracts/command";
import { shellValueFromBytes } from "safe-bash-contracts/value";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts/io";
import type { ByteSink } from "safe-bash-contracts/io";
import { createWkhtmltopdfCommand, runWkhtmltopdf, type WkhtmltopdfCommandOptions, type StaticRenderer } from "./command.js";

const limits = {
  parse: { maxArguments: 64, maxTextBytes: 8192, maxObjects: 8, maxWork: 32768 },
  resources: { maxInputBytes: 8192, maxDecodedBytes: 8192, maxRetainedBytes: 32768, maxWork: 32768, maxResources: 16 },
  maxOutputBytes: 8192, maxOutputChunks: 128, maxBatchJobs: 8,
};
const encoder = new TextEncoder();
function fixture(args: readonly string[]) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const cleanups: (() => void | Promise<void>)[] = [];
  const controller = new AbortController();
  const context = {
    command: "wkhtmltopdf", args, fs: new MemoryFileSystem(), cwd: "/", env: {},
    signal: controller.signal, stdin: toByteSource(""),
    stdout: { async write(bytes: Uint8Array) { stdout.push(new Uint8Array(bytes)); } } as ByteSink,
    stderr: { async write(bytes: Uint8Array) { stderr.push(new Uint8Array(bytes)); } },
    registerCleanup(cleanup: () => void | Promise<void>) { cleanups.push(cleanup); },
  };
  return { context, stdout, stderr, controller, cleanups };
}
function renderer(open: StaticRenderer["open"]): StaticRenderer {
  return { profile: { id: "test-static", features: [] }, open };
}
const output = () => ({ success: true, errorCode: 0, chunks: [encoder.encode("%PDF-test")], async close() {} });

test("same-file and symlink output aliases preserve the input before renderer acquisition", async () => {
  for (const destination of ["input.html", "alias.pdf"]) {
    const f = fixture(["input.html", destination]);
    const original = encoder.encode("<p>preserve</p>");
    await f.context.fs.writeFile("/input.html", original);
    await f.context.fs.symlink("/input.html", "/alias.pdf");
    let opened = false;
    const result = await runWkhtmltopdf(f.context, { limits, renderer: renderer(async () => {
      opened = true;
      return output();
    }) });
    assert.equal(result.exitCode, 1);
    assert.equal(opened, false);
    assert.deepEqual(await f.context.fs.readFile("/input.html"), original);
  }
});

test("conditional publication refuses destination replacement during rendering", async () => {
  for (const exists of [false, true]) {
    const f = fixture(["input.html", "output.pdf"]);
    await f.context.fs.writeFile("/input.html", encoder.encode("html"));
    if (exists) await f.context.fs.writeFile("/output.pdf", encoder.encode("old"));
    let closed = 0;
    const result = await runWkhtmltopdf(f.context, { limits, renderer: renderer(async () => {
      await f.context.fs.writeFile("/output.pdf", encoder.encode("concurrent"));
      return { ...output(), async close() { closed++; } };
    }) });
    assert.equal(result.exitCode, 1);
    assert.equal(closed, 1);
    assert.equal(new TextDecoder().decode(await f.context.fs.readFile("/output.pdf")), "concurrent");
  }
});

test("input symlink and directory aliases cannot hide a same-file destination", async () => {
  const f = fixture(["/alias/input.html", "/docs/input.html"]);
  await f.context.fs.mkdir("/docs");
  await f.context.fs.writeFile("/docs/input.html", encoder.encode("original"));
  await f.context.fs.symlink("/docs", "/alias");
  const result = await runWkhtmltopdf(f.context, { limits, renderer: renderer(async () => {
    throw new Error("same-file input must not reach renderer");
  }) });
  assert.equal(result.exitCode, 1);
  assert.equal(new TextDecoder().decode(await f.context.fs.readFile("/docs/input.html")), "original");
});

test("different VFS paths with hardlink identity are refused before rendering", async () => {
  const f = fixture(["input.html", "alias.pdf"]);
  await f.context.fs.writeFile("/input.html", encoder.encode("original"));
  await f.context.fs.link("/input.html", "/alias.pdf");
  const result = await runWkhtmltopdf(f.context, { limits, renderer: renderer(async () => {
    throw new Error("hardlink must not reach renderer");
  }) });
  assert.equal(result.exitCode, 1);
  assert.equal(new TextDecoder().decode(await f.context.fs.readFile("/input.html")), "original");
});

test("VFS publication quota failures preserve old content and close the renderer", async () => {
  for (const exists of [false, true]) {
    const f = fixture(["input.html", "output.pdf"]);
    f.context.fs = new MemoryFileSystem({ maxBytes: 8 });
    await f.context.fs.writeFile("/input.html", encoder.encode("html"));
    if (exists) await f.context.fs.writeFile("/output.pdf", encoder.encode("old"));
    let closed = 0;
    const result = await runWkhtmltopdf(f.context, { limits, renderer: renderer(async () => ({
      ...output(), async close() { closed++; },
    })) });
    assert.equal(result.exitCode, 1);
    assert.equal(closed, 1);
    assert.match(new TextDecoder().decode(f.stderr[0]), /ENOSPC/);
    if (exists) assert.equal(new TextDecoder().decode(await f.context.fs.readFile("/output.pdf")), "old");
    else await assert.rejects(f.context.fs.stat("/output.pdf"), { code: "ENOENT" });
  }
});

test("absent conditional authority refuses conversion without ordinary write fallback", async () => {
  const f = fixture(["input.html", "output.pdf"]);
  Object.defineProperty(f.context.fs, "writeFileConditional", { value: undefined });
  f.context.fs.writeFile = async () => { throw new Error("ordinary write forbidden"); };
  f.context.fs.openReadFile = async () => { throw new Error("input acquisition forbidden"); };
  const result = await runWkhtmltopdf(f.context, { limits, renderer: renderer(async () => {
    throw new Error("renderer acquisition forbidden");
  }) });
  assert.deepEqual(result, { kind: "rejected", exitCode: 1, code: "UNSUPPORTED_CAPABILITY" });
});

test("cancellation while PDF output is stalled closes the renderer once and preserves destination", async () => {
  const f = fixture(["input.html", "output.pdf"]);
  await f.context.fs.writeFile("/input.html", encoder.encode("html"));
  await f.context.fs.writeFile("/output.pdf", encoder.encode("old"));
  let closed = 0;
  const invocation = runWkhtmltopdf(f.context, { limits, renderer: renderer(async () => ({
    success: true, errorCode: 0,
    chunks: { [Symbol.asyncIterator]: () => ({ next: () => {
      queueMicrotask(() => f.controller.abort(0));
      return new Promise(() => {});
    } }) },
    async close() { closed++; },
  })) });
  await assert.rejects(invocation, reason => reason === 0);
  await Promise.all(f.cleanups.map(cleanup => cleanup()));
  assert.equal(closed, 1);
  assert.equal(new TextDecoder().decode(await f.context.fs.readFile("/output.pdf")), "old");
});

test("CLI and SDK share parsing, literal VFS paths, result and output", async () => {
  const sdk = fixture(["--disable-javascript", "--", "-input#literal.html", "-"]);
  await sdk.context.fs.writeFile("/-input#literal.html", encoder.encode("<p>hello</p>"));
  let closed = 0;
  const options: WkhtmltopdfCommandOptions = { limits, renderer: renderer(async (request) => {
    assert.ok(sdk.cleanups.length);
    assert.equal(request.signal.aborted, false);
    assert.equal(request.job.objects[0]!.input, "-input#literal.html");
    assert.equal(new TextDecoder().decode(request.inputs[0]!), "<p>hello</p>");
    return { ...output(), async close() { closed++; } };
  }) };
  const result = await runWkhtmltopdf(sdk.context, options);
  assert.equal(result.exitCode, 0);
  assert.equal(closed, 1);
  await sdk.cleanups[0]!();
  assert.equal(closed, 1);
  const cli = fixture(sdk.context.args);
  cli.context.fs = sdk.context.fs;
  const command = createWkhtmltopdfCommand(options);
  assert.equal(command.name, "wkhtmltopdf");
  assert.equal((await command.execute(cli.context)).exitCode, result.exitCode);
  assert.deepEqual(cli.stdout, sdk.stdout);
});

test("missing renderer and unknown flags fail deterministically before input I/O", async () => {
  for (const args of [["in.html", "out.pdf"], ["--unknown", "in.html", "out.pdf"]]) {
    const f = fixture(args);
    const result = await runWkhtmltopdf(f.context, { limits });
    assert.equal(result.exitCode, 1);
    assert.equal(f.stdout.length, 0);
    assert.ok(new TextDecoder().decode(f.stderr[0]).startsWith("wkhtmltopdf: "));
    assert.equal(result.kind, "rejected");
  }
});

test("renderer receives document bytes and bounds without ambient credentials or host capabilities", async () => {
  const f = fixture(["input.html", "-"]);
  f.context.env = { AWS_SECRET_ACCESS_KEY: "negative-control-only", PATH: "/forbidden-bin" };
  await f.context.fs.writeFile("/input.html", encoder.encode("<script>fetch('https://denied.invalid')</script>"));
  const result = await runWkhtmltopdf(f.context, { limits, renderer: renderer(async request => {
    assert.deepEqual(Object.keys(request).sort(), ["inputs", "job", "limits", "signal"]);
    assert.equal(new TextDecoder().decode(request.inputs[0]), "<script>fetch('https://denied.invalid')</script>");
    return output();
  }) });
  assert.equal(result.exitCode, 0);
});

test("CLI options cannot grant host, network, script or stylesheet authority", async () => {
  for (const options of [
    ["--enable-local-file-access"],
    ["--proxy", "http://example.invalid"],
    ["--run-script", "fetch('http://example.invalid')"],
    ["--user-style-sheet", "/host.css"],
  ]) {
    const f = fixture([...options, "input.html", "output.pdf"]);
    f.context.fs.openReadFile = async () => { throw new Error("input must not open"); };
    const result = await runWkhtmltopdf(f.context, {
      limits, renderer: renderer(async () => { throw new Error("renderer must not open"); }),
    });
    assert.equal(result.kind, "rejected");
    assert.equal(result.exitCode, 1);
    assert.match(new TextDecoder().decode(f.stderr[0]), /UNSUPPORTED_CAPABILITY/);
    assert.equal(f.stdout.length, 0);
  }
});

test("information output respects the output byte limit before writing", async () => {
  for (const action of ["--help", "--version"]) {
    const f = fixture([action]);
    const result = await runWkhtmltopdf(f.context, { limits: { ...limits, maxOutputBytes: 2 } });
    assert.equal(result.kind, "rejected");
    assert.equal(result.exitCode, 1);
    assert.equal(f.stdout.length, 0);
    assert.match(new TextDecoder().decode(f.stderr[0]), /LIMIT_EXCEEDED/);
  }
});

test("resource limits are validated even for information-only invocations", async () => {
  for (const key of ["maxInputBytes", "maxDecodedBytes", "maxRetainedBytes", "maxWork", "maxResources"] as const) {
    for (const value of [0, -1, NaN, Infinity, 1.5]) {
      const f = fixture(["--help"]);
      const result = await runWkhtmltopdf(f.context, {
        limits: { ...limits, resources: { ...limits.resources, [key]: value } },
      });
      assert.equal(result.kind, "rejected", `${key}=${value}`);
      assert.equal(result.exitCode, 1);
      assert.equal(f.stdout.length, 0);
      assert.match(new TextDecoder().decode(f.stderr[0]), /INVALID_VALUE/);
    }
  }
});

test("raw CLI argv uses strict UTF-8 rather than lossy display strings", async () => {
  const f = fixture([]);
  const carrier = createCommandArguments([shellValueFromBytes(Uint8Array.of(0xff)), "-"]);
  const result = await runWkhtmltopdf({ ...f.context, args: carrier.args, argumentValues: carrier }, { limits });
  assert.equal(result.exitCode, 1);
  assert.match(new TextDecoder().decode(f.stderr[0]), /UTF-8/);
});

test("literal Unicode SDK strings are preserved independently of raw CLI encoding", async () => {
  const f = fixture(["--title", "\ud800", "-", "-"]);
  const result = await runWkhtmltopdf(f.context, { limits, renderer: renderer(async request => {
    assert.equal(request.job.global.documentTitle, "\ud800");
    return output();
  }) });
  assert.equal(result.exitCode, 0);
});

test("cross-realm renderer byte views retain only owned view bytes", async () => {
  const f = fixture(["-", "-"]);
  const bytes = runInNewContext("new Uint8Array([0, 37, 80, 68, 70, 0]).subarray(1, 5)") as Uint8Array;
  const result = await runWkhtmltopdf(f.context, { limits, renderer: renderer(async () => ({
    ...output(), chunks: [bytes], async close() { bytes.fill(0); },
  })) });
  assert.equal(result.exitCode, 0);
  assert.equal(new TextDecoder().decode(f.stdout[0]), "%PDF");
});

test("VFS read requests respect small caller byte budgets", async () => {
  const f = fixture(["a.html", "-"]);
  f.context.fs.openReadFile = async () => ({
    async stat() { throw new Error("unused"); },
    async close() {},
    async read(position, size) {
      assert.ok(size <= 128, "read request must fit the configured input-byte bound");
      return position === 0 ? encoder.encode("a") : new Uint8Array();
    },
  });
  const result = await runWkhtmltopdf(f.context, {
    limits: { ...limits, resources: { ...limits.resources, maxInputBytes: 128 } },
    renderer: renderer(async () => output()),
  });
  assert.equal(result.exitCode, 0, new TextDecoder().decode(f.stderr[0]));
});

test("preserves the caller's shared input budget and failure identity", async () => {
  const f = fixture(["-", "-"]);
  f.context.stdin = toByteSource("abc");
  const failure = new Error("shared input budget exhausted");
  let opened = false;
  const context = { ...f.context, inputBudget: { maxBytes: 2, check(total: number) { if (total > 2) throw failure; } } };
  await assert.rejects(runWkhtmltopdf(context, { limits, renderer: renderer(async () => {
    opened = true;
    return output();
  }) }), error => error === failure);
  assert.equal(opened, false);
  assert.equal(f.stdout.length, 0);
});

test("single-job source statuses retain 404=2 and 401=3; no failed output publication", async () => {
  for (const [errorCode, exitCode] of [[404, 2], [401, 3], [500, 1]]) {
    const f = fixture(["-", "out.pdf"]);
    let closed = false;
    const result = await runWkhtmltopdf(f.context, { limits, renderer: renderer(async () => ({
      ...output(), success: false, errorCode: errorCode!, async close() { closed = true; },
    })) });
    assert.equal(result.exitCode, exitCode);
    assert.equal(closed, true);
    await assert.rejects(f.context.fs.stat("/out.pdf"), error => (error as { code?: string }).code === "ENOENT");
  }
});

test("bounded PDF stage copies producer chunks before producer advances or closes", async () => {
  const f = fixture(["-", "-"]);
  const bytes = encoder.encode("%PDF-A");
  const result = await runWkhtmltopdf(f.context, { limits, renderer: renderer(async () => ({
    success: true, errorCode: 0,
    chunks: (async function* () { yield bytes; bytes.fill(0); })(),
    async close() { bytes.fill(1); },
  })) });
  assert.equal(result.exitCode, 0);
  assert.equal(new TextDecoder().decode(f.stdout[0]), "%PDF-A");
});

test("output overflow closes renderer without writing any destination bytes", async () => {
  const f = fixture(["-", "-"]);
  let closed = 0;
  const result = await runWkhtmltopdf(f.context, { limits: { ...limits, maxOutputBytes: 2 }, renderer: renderer(async () => ({
    ...output(), async close() { closed++; },
  })) });
  assert.equal(result.exitCode, 1);
  assert.equal(closed, 1);
  assert.equal(f.stdout.length, 0);
});

test("retained bound covers HTML inputs, output chunks and output assembly together", async () => {
  const f = fixture(["-", "-"]);
  f.context.stdin = toByteSource("0123456789");
  let closed = false;
  const result = await runWkhtmltopdf(f.context, {
    limits: { ...limits, resources: { ...limits.resources, maxRetainedBytes: 20 } },
    renderer: renderer(async () => ({ ...output(), chunks: [encoder.encode("0123456789")], async close() { closed = true; } })),
  });
  assert.equal(result.exitCode, 1);
  assert.equal(closed, true);
  assert.equal(f.stdout.length, 0);
});

test("cancellation preserves falsey reason and awaits cleanup", async () => {
  const f = fixture(["-", "-"]);
  let closed = false;
  await assert.rejects(runWkhtmltopdf(f.context, { limits, renderer: renderer(async () => {
    f.controller.abort(0);
    return { ...output(), async close() { closed = true; } };
  }) }), error => error === 0);
  assert.equal(closed, true);
});

test("batch stops at first failed conversion and flattens its status to one", async () => {
  const f = fixture(["--read-args-from-stdin"]);
  f.context.stdin = toByteSource("a.html a.pdf\nb.html b.pdf\n");
  await f.context.fs.writeFile("/a.html", encoder.encode("a"));
  let jobs = 0;
  const result = await runWkhtmltopdf(f.context, { limits, renderer: renderer(async () => {
    jobs++;
    return { ...output(), success: false, errorCode: 404 };
  }) });
  assert.equal(result.exitCode, 1);
  assert.equal(jobs, 1);
});

test("batch preserves operands equal to the batch option token", async () => {
  const f = fixture(["--title", "--read-args-from-stdin", "--read-args-from-stdin"]);
  f.context.stdin = toByteSource("a.html -\n");
  await f.context.fs.writeFile("/a.html", encoder.encode("a"));
  let jobs = 0;
  const result = await runWkhtmltopdf(f.context, { limits, renderer: renderer(async request => {
    jobs++;
    assert.equal(request.job.global.documentTitle, "--read-args-from-stdin");
    return output();
  }) });
  assert.equal(result.exitCode, 0);
  assert.equal(jobs, 1);
});

test("registered cleanup drains admitted VFS close work", async () => {
  const f = fixture(["a.html", "-"]);
  let releaseClose!: () => void;
  const closeGate = new Promise<void>(resolve => { releaseClose = resolve; });
  let readStarted!: () => void;
  const reading = new Promise<void>(resolve => { readStarted = resolve; });
  let closeStarted!: () => void;
  const closing = new Promise<void>(resolve => { closeStarted = resolve; });
  let closed = 0;
  f.context.fs.openReadFile = async (_path, options) => ({
    async stat() { throw new Error("unused"); },
    read(_position, _size, readOptions) {
      assert.equal(options!.signal, readOptions!.signal);
      readStarted();
      return new Promise((_resolve, reject) => {
        readOptions!.signal!.addEventListener("abort", () => reject(readOptions!.signal!.reason), { once: true });
      });
    },
    async close() { closeStarted(); await closeGate; closed++; },
  });
  const execution = runWkhtmltopdf(f.context, { limits, renderer: renderer(async () => output()) });
  const observed = execution.then(() => {}, () => {});
  await reading;
  let settled = false;
  const cleanup = f.cleanups[0]!();
  const drained = Promise.resolve(cleanup).then(() => { settled = true; });
  await closing;
  await Promise.resolve();
  assert.equal(settled, false);
  releaseClose();
  await drained;
  await observed;
  assert.equal(closed, 1);
});

test("awaits owned stdout writes and drains them through invocation cleanup", async () => {
  const f = fixture(["-", "-"]);
  let begin!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const consumer = new AbortController();
  f.context.stdout = {
    async write() { throw new Error("must enroll the owned output capability"); },
    ownedOutput: { consumerClosed: consumer.signal, async write() { begin(); await gate; } },
  };
  const execution = runWkhtmltopdf(f.context, { limits, renderer: renderer(async () => output()) });
  const observed = execution.then(() => {}, () => {});
  await started;
  f.controller.abort(0);
  let settled = false;
  void observed.then(() => { settled = true; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);
  release();
  await assert.rejects(execution, error => error === 0);
});

test("renderer cleanup failure still drains an admitted owned stderr write", async () => {
  const f = fixture(["-", "-"]);
  let begin!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const failure = new Error("renderer close failed");
  const context = { ...f.context, stderr: {
    async write() { throw new Error("must use the owned destination"); },
    ownedOutput: { consumerClosed: new AbortController().signal, async write() { begin(); await gate; } },
  } };
  const execution = runWkhtmltopdf(context, {
    limits: { ...limits, maxOutputBytes: 2 },
    renderer: renderer(async () => ({ ...output(), async close() { throw failure; } })),
  });
  const observed = execution.then(() => {}, () => {});
  await started;
  let settled = false;
  const cleanup = Promise.resolve(f.cleanups[0]!()).then(() => { settled = true; }, () => { settled = true; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false, "cleanup must wait for the enrolled stderr write despite renderer failure");
  } finally {
    release();
    await cleanup;
    await observed;
  }
});
