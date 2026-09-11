import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { gzipSync } from "node:zlib";
import { EventEmitter } from "node:events";
import { CommandRegistry, FsError, readBytes, writeBytes, type CommandDefinition } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell, ShellLimitError, type ShellOptions } from "../../src/shell/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createTextProgramCommands } from "../../src/commands/text-programs/index.js";
import { createTarCommand } from "../../src/commands/archive/index.js";
import { createColumnCommand } from "../../src/commands/column/index.js";
import { createTreeCommand } from "../../src/commands/tree/index.js";
import { createDuCommand } from "../../src/commands/du/index.js";
import { createSplitCommands } from "../../src/commands/split/index.js";
import { createHtmlToMarkdownCommand } from "../../src/commands/html-to-markdown/index.js";
import { createDiffPatchCommands } from "../../src/commands/diff-patch/index.js";
import { diagnostic as searchDiagnostic } from "../../src/commands/search/shared.js";
import { networkError } from "../../src/commands/network/shared.js";
import { createSafeJsCommands, type SafeJsRuntime } from "../../src/commands/safejs/index.js";
import { RegexExecutionError, RegexExecutor } from "../../src/commands/regex-execution/portable.js";
import { createByteCommands } from "../../src/commands/bytes/index.js";
import { createBoundedRegexProvider } from "../../src/commands/regex-execution/bounded-provider.js";
import { createExprCommandWithExecutor } from "../../src/commands/expr/command.js";
import { createGrepCommands } from "../../src/commands/search/grep.js";
import { compile } from "../../src/commands/regex-execution/matching.js";
import type { RegexWorkerRequest } from "../../src/commands/regex-execution/provider.js";
import { PublicDiagnostic } from "../../src/diagnostics.js";

const secret = "host-private-657 /srv/private/key?credential=canary";
const opaque = "shell: line 1: internal error\n";
const encoder = new TextEncoder();

function grepConstructorFixture(context: TestContext, injected?: { reason: unknown }) {
  const seen: unknown[] = [];
  const worker = Object.assign(new EventEmitter(), {
    postMessage(request: RegexWorkerRequest) {
      if (request.descriptor.kind !== "grep") throw new TypeError("Expected grep descriptor");
      const replacement = injected ? context.mock.method(globalThis, "RegExp", function () { throw injected.reason; }) : undefined;
      let failure: { reason: unknown } | undefined;
      try { compile(request.descriptor); }
      catch (reason) { failure = { reason }; }
      finally { replacement?.mock.restore(); }
      if (!failure) throw new Error("Expected constructor failure");
      if (failure.reason instanceof PublicDiagnostic) worker.emit("message", { id: request.id, error: failure.reason.message });
      else worker.emit("error", failure.reason);
    },
    async terminate() { return 0; },
  });
  const executor = new RegexExecutor({ createWorker() {
    queueMicrotask(() => worker.emit("message", { ready: true }));
    return worker;
  } });
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createGrepCommands(executor)), onInternalError(reason) { seen.push(reason); } });
  context.after(async () => { await shell.dispose(); await executor.dispose(); });
  return { shell, seen };
}

for (const [label, reason] of [
  ["TypeError", new TypeError(secret)], ["false", false], ["null", null],
  ["zero", 0], ["empty string", ""], ["undefined", undefined],
] as const) {
  test(`grep constructor preserves unexpected ${label} for host hook`, async context => {
    const { shell, seen } = grepConstructorFixture(context, { reason });
    const result = await shell.exec("grep x", { stdin: "x\n" });
    assert.equal(seen.length, 1);
    assert.ok(Object.is(seen[0], reason));
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "grep: regex WORKER_ERROR: internal error\n");
  });
}

test("grep constructor retains genuine SyntaxError as public usage diagnostic", async context => {
  const { shell, seen } = grepConstructorFixture(context);
  const result = await shell.exec("grep '['", { stdin: "x\n" });
  assert.deepEqual(seen, []);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "grep: invalid regular expression '['\n");
});

function fixture(context: TestContext, definitions: readonly CommandDefinition[] = [], options: Partial<ShellOptions> = {}) {
  const fs = new MemoryFileSystem();
  const commands = new CommandRegistry([
    ...createStandardCommands(), ...createTextProgramCommands(), createTarCommand(),
    createColumnCommand(), createTreeCommand(), createDuCommand(), ...createSplitCommands(),
    createHtmlToMarkdownCommand(), ...createDiffPatchCommands(), ...createByteCommands(),
    { name: "copy", async execute(command) {
      for await (const chunk of readBytes(command.stdin, command.signal)) await writeBytes(command.stdout, chunk, command.signal);
      return { exitCode: 0 };
    } },
    ...definitions,
  ]);
  const shell = new Shell({ fs, commands, ...options });
  context.after(() => shell.dispose());
  return { shell, fs, commands };
}

const failures = [new TypeError(secret), new Error(secret), secret, null, false, 0, ""];
for (const [index, failure] of failures.entries()) {
  test(`RED unknown command reason ${index} is opaque and script status stays unchanged`, async context => {
    const { shell } = fixture(context, [{ name: "boom", async execute() { throw failure; } }]);
    const result = await shell.exec("boom; printf 'after:%s' \"$?\"");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "after:1");
    assert.equal(result.stderr, opaque);
  });
}

for (const [source, output, diagnostic, exitCode] of [
  ["boom 2>&1", opaque, "", 1],
  ["boom 2>&1 | copy", opaque, "", 0],
  ["set -o pipefail; boom 2>&1 | copy", opaque, "", 1],
  ["boom |& copy", opaque, "", 0],
  ["printf '%s' \"$(boom 2>&1)\"", opaque.trimEnd(), "", 0],
  ["boom 2>/diagnostic; copy </diagnostic", opaque, "", 0],
] as const) {
  test(`RED routed diagnostic ${source}`, async context => {
    const { shell } = fixture(context, [{ name: "boom", async execute() { throw new TypeError(secret); } }]);
    const result = await shell.exec(source);
    assert.equal(result.exitCode, exitCode);
    assert.equal(result.stdout, output);
    assert.equal(result.stderr, diagnostic);
  });
}

test("RED middleware and borrowed sinks receive only opaque bytes", async context => {
  const { shell } = fixture(context);
  shell.use(async command => { if (command.command === "boom") throw new TypeError(secret); return { exitCode: 0 }; });
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await shell.exec("boom 2>&1; boom", {
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(Buffer.concat(stdout).toString(), opaque);
  assert.equal(Buffer.concat(stderr).toString(), opaque);
  assert.equal(result.stdout, opaque);
  assert.equal(result.stderr, opaque);
});

for (const [source, prefix, exitCode] of [
  ["cat /victim", "cat", 1], ["sed '' /victim", "sed", 1],
  ["awk '{print}' /victim", "awk", 1], ["tar -cf - /victim", "tar", 2],
  ["column /victim", "column", 1], ["split /victim", "split", 1],
  ["html-to-markdown /victim", "html-to-markdown", 1],
  ["diff /victim /other", "diff", 2],
] as const) {
  test(`RED family-local FS formatter ${prefix}`, async context => {
    const { fs, shell } = fixture(context);
    await fs.writeFile("/victim", encoder.encode("hello\n"));
    await fs.writeFile("/other", encoder.encode("other\n"));
    for (const method of ["stat", "lstat", "readFile", "readStream", "openReadFile"] as const) {
      const original = fs[method];
      context.mock.method(fs, method, (...args: unknown[]) => {
        if (args[0] === "/victim") throw new TypeError(secret);
        return Reflect.apply(original, fs, args);
      });
    }
    const result = await shell.exec(source);
    assert.equal(result.exitCode, exitCode);
    assert.equal(result.stdout, "");
    const notice = prefix === "tar" ? "tar: removing leading '/' from member names\n" : "";
    assert.equal(result.stderr, `${notice}${prefix}: internal error\n`);
  });
}

for (const source of ["tree /victim", "du /victim"] as const) {
  test(`RED traversal diagnostic remains useful without host text: ${source}`, async context => {
    const { shell, fs } = fixture(context);
    for (const method of ["stat", "lstat"] as const) {
      const original = fs[method];
      context.mock.method(fs, method, (...args: unknown[]) => {
        if (args[0] === "/victim") throw new TypeError(secret);
        return Reflect.apply(original, fs, args);
      });
    }
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 1);
    assert.equal((result.stdout + result.stderr).includes(secret), false);
    assert.equal((result.stdout + result.stderr).includes("internal error"), true);
    assert.equal((result.stdout + result.stderr).includes("/victim"), true);
  });
}

test("RED search formatter is sanitized before it returns a result", async context => {
  const { shell } = fixture(context, [{ name: "search-probe", async execute(command) {
    await searchDiagnostic(command, new TypeError(secret));
    return { exitCode: 2 };
  } }]);
  const result = await shell.exec("search-probe 2>&1");
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "rg: internal error\n");
  assert.equal(result.stderr, "");
});

test("CONTROL FsError's explicit public message survives; native cause stays private", async context => {
  const cause = new TypeError(secret);
  const failure = new FsError("EIO", { path: "/virtual", message: "adapter is read-only today", cause });
  const { shell } = fixture(context, [{ name: "known", async execute() { throw failure; } }]);
  const result = await shell.exec("known");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "shell: line 1: EIO: adapter is read-only today '/virtual'\n");
  assert.equal(failure.cause, cause);
  assert.equal(result.stderr.includes(secret), false);
});

for (const [source, exitCode, diagnostic] of [
  ["cat /missing", 1, "cat: ENOENT: no such file or directory, readStream '/missing'\n"],
  ["cat --bad-option", 2, "cat: unrecognized option '--bad-option'\n"],
  ["cat < /missing", 1, "shell: line 1: /missing: No such file or directory\n"],
  ["printf '%s' x >&9", 1, "shell: line 1: 9: Bad file descriptor\n"],
  ["let '1/0'", 1, 'shell: line 1: let: 1/0: division by 0 (error token is "0")\n'],
  ["readonly held=1; held=2", 1, "shell: line 1: held: readonly variable\n"],
  ["split --bad-option", 1, "split: unrecognized option '--bad-option'\n"],
  ["find / -delete -prune", 1, "find: -delete implies -depth; -prune is ineffective unless -depth is explicitly supplied\n"],
  ["printf '?' | base64 -d", 1, "base64: invalid input\n"],
  ["printf 'x' | xxd -r -p", 1, "xxd: invalid input: expected hexadecimal digits or ASCII whitespace\n"],
  ["printf 'x' | gunzip", 1, "gunzip: unexpected end of file\n"],
] as const) {
  test(`CONTROL existing user diagnostic ${source}`, async context => {
    const { shell } = fixture(context);
    const result = await shell.exec(source);
    assert.equal(result.exitCode, exitCode);
    assert.equal(result.stderr, diagnostic);
  });
}

for (const reason of [null, false, 0, ""] as const) {
  test(`CONTROL active abort preserves ${JSON.stringify(reason)} identity`, async context => {
    const controller = new AbortController();
    const { shell } = fixture(context, [{ name: "cancel", async execute() { controller.abort(reason); throw new TypeError(secret); } }]);
    await assert.rejects(shell.exec("cancel", { signal: controller.signal }), error => Object.is(error, reason));
  });
}

for (const reason of [new TypeError(secret), null, false, 0, "", undefined] as const) {
  test(`CONTROL cleanup rejects with original ${typeof reason} identity`, async context => {
    const { shell } = fixture(context, [{ name: "clean", async execute(command) {
      assert.ok(command.registerCleanup);
      command.registerCleanup(async () => { throw reason; });
      return { exitCode: 0 };
    } }]);
    await assert.rejects(shell.exec("clean"), error => Object.is(error, reason));
  });
}

test("CONTROL ShellLimitError remains host-visible by identity", async context => {
  const failure = new ShellLimitError("maxCommands");
  const { shell } = fixture(context, [{ name: "limited", async execute() { throw failure; } }]);
  await assert.rejects(shell.exec("limited"), error => error === failure);
});

test("CONTROL curl already maps foreign transport errors without their message", () => {
  const result = networkError(new TypeError(secret));
  assert.equal(result.message, "Network transfer failed");
  assert.equal(result.exitCode, 56);
});

test("RED native errno mappings retain safe text without reading native message", async context => {
  let messageReads = 0;
  const failure = Object.assign(new TypeError(), { code: "EACCES" });
  Object.defineProperty(failure, "message", { get() { messageReads++; return secret; } });
  const { shell, fs } = fixture(context);
  context.mock.method(fs, "access", () => { throw failure; });
  const result = await shell.exec("cat < /victim");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "shell: line 1: /victim: Permission denied\n");
  assert.equal(messageReads, 0);
});

test("RED Error-name spoofing is not a public diagnostic grant", async context => {
  let coercions = 0;
  const failure = { name: "FsError", code: "EIO", message: secret, toString() { coercions++; return secret; } };
  const { shell } = fixture(context, [{ name: "spoof", async execute() { throw failure; } }]);
  const result = await shell.exec("spoof");
  assert.equal(result.stderr, opaque);
  assert.equal(coercions, 0);
});

test("RED stream producer failures are sanitized without dropping earlier output", async context => {
  const { shell } = fixture(context);
  const result = await shell.exec("cat", { stdin: { async *[Symbol.asyncIterator]() {
    yield encoder.encode("prefix\n");
    throw new TypeError(secret);
  } } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "prefix\n");
  assert.equal(result.stderr, "cat: internal error\n");
});

for (const stage of ["createBudget", "makeFsModule", "run"] as const) {
  test(`RED optional SafeJS host ${stage} rejection is opaque`, async context => {
    const runtime = {
      createBudget() { return {}; },
      makeFsModule() { return {}; },
      declareHostOperation(operation) { return operation; },
      async run() { return { ok: true }; },
    } satisfies SafeJsRuntime<object>;
    runtime[stage] = () => { throw new TypeError(secret); };
    const { shell } = fixture(context, createSafeJsCommands({ runtime }));
    const result = await shell.exec("safejs -e '1'");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "safejs: internal error\n");
  });
}

for (const command of ["gzip", "gunzip", "tar -tzf -"] as const) {
  for (const failure of [new TypeError(secret), "private-string", null, false, 0, "", undefined] as const) {
    test(`HOST compression source ${command} preserves original ${typeof failure}`, async context => {
      const seen: unknown[] = [];
      const { shell } = fixture(context, [], { onInternalError(reason) { seen.push(reason); } });
      const result = await shell.exec(command, { stdin: { async *[Symbol.asyncIterator]() {
        if (command !== "gzip") yield gzipSync(Buffer.alloc(1024));
        throw failure;
      } } });
      assert.deepEqual(seen, [failure]);
      assert.equal(result.stderr.includes(secret), false);
      assert.equal(result.stderr.includes("internal error"), true);
    });
  }
}

test("HOST compression cleanup diagnostic retains both original aggregate causes", async context => {
  const failure = new TypeError(secret);
  const cleanupFailure = new Error(`cleanup ${secret}`);
  const seen: unknown[] = [];
  const { shell, fs } = fixture(context, [], { onInternalError(error) { seen.push(error); } });
  await fs.writeFile("/input", encoder.encode("retained input"));
  const lstat = fs.lstat.bind(fs);
  let staged = "";
  context.mock.method(fs, "writeStream", async (path: string) => {
    staged = path;
    throw failure;
  });
  context.mock.method(fs, "lstat", async (...args: Parameters<typeof fs.lstat>) => {
    if (staged && args[0] === staged.slice(0, staged.lastIndexOf("/"))) throw cleanupFailure;
    return lstat(...args);
  });
  const result = await shell.exec("gzip /input");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "gzip: compression failed and staging cleanup failed; input retained\n");
  assert.equal(seen.length, 1);
  assert.ok(seen[0] instanceof AggregateError);
  assert.equal(seen[0].message, "compression failed and staging cleanup failed; input retained");
  assert.equal(seen[0].errors.length, 2);
  assert.equal(seen[0].errors[0], failure);
  assert.equal(seen[0].errors[1], cleanupFailure);
  assert.deepEqual(await fs.readFile("/input"), encoder.encode("retained input"));
  assert.deepEqual(await fs.readFile(staged), new Uint8Array());
  await assert.rejects(fs.stat("/input.gz"), { code: "ENOENT" });
});

for (const [command, input, message] of [
  ["tar -tzf -", Buffer.from("not gzip"), "incorrect header check"],
  ["tar -tzf -", gzipSync(Buffer.alloc(1024)).subarray(0, 12), "unexpected end of file"],
] as const) {
  test(`CONTROL native codec diagnostic ${message}`, async context => {
    const { shell } = fixture(context);
    const result = await shell.exec(command, { stdin: input });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr, `tar: ${message}\n`);
  });
}

test("CONTROL optional SafeJS explicit guest error result remains guest-visible", async context => {
  const runtime: SafeJsRuntime<object> = {
    createBudget() { return {}; }, makeFsModule() { return {}; },
    declareHostOperation(operation) { return operation; },
    async run() { return { ok: false, error: { name: "ParseError", message: "guest parse diagnostic" } }; },
  };
  const { shell } = fixture(context, createSafeJsCommands({ runtime }));
  const result = await shell.exec("safejs -e '1'");
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "safejs: guest parse diagnostic\n");
});

test("RED regex worker error event must not launder host text into a trusted error", async () => {
  const worker = Object.assign(new EventEmitter(), {
    postMessage() { queueMicrotask(() => worker.emit("error", new TypeError(secret))); },
    async terminate() { return 0; },
  });
  const executor = new RegexExecutor({ createWorker() {
    queueMicrotask(() => worker.emit("message", { ready: true }));
    return worker;
  } });
  const session = executor.open(new AbortController().signal);
  try {
    await assert.rejects(session.run({ kind: "grep", patterns: ["x"], fixed: true, extended: false, insensitive: false, whole: false, word: false },
      [{ bytes: encoder.encode("x"), all: false, terminated: true }]), error => {
      assert.ok(error instanceof RegexExecutionError);
      assert.equal(error.code, "WORKER_ERROR");
      assert.equal(error.message, "regex WORKER_ERROR: internal error");
      return true;
    });
  } finally { await session.close(); await executor.dispose(); }
});

test("CONTROL bounded regex syntax errors remain public MATCH errors", async () => {
  const executor = new RegexExecutor(createBoundedRegexProvider());
  const session = executor.open(new AbortController().signal);
  try {
    await assert.rejects(session.run({ kind: "grep", patterns: ["["], fixed: false, extended: true, insensitive: false, whole: false, word: false },
      [{ bytes: encoder.encode("x"), all: false, terminated: true }]), error => {
      assert.ok(error instanceof RegexExecutionError);
      assert.equal(error.code, "MATCH");
      assert.equal(error.message.startsWith("invalid ERE"), true);
      return true;
    });
  } finally { await session.close(); await executor.dispose(); }
});

test("HOST failed diagnostic sink is observable without changing command status", async context => {
  const original = new TypeError(secret), sinkFailure = new TypeError("sink-private");
  const seen: unknown[] = [];
  const { shell } = fixture(context, [{ name: "boom", async execute() { throw original; } }], { onInternalError(reason) { seen.push(reason); } });
  const result = await shell.exec("boom", { stderr: { async write() { throw sinkFailure; } } });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(seen, [original, sinkFailure]);
});

test("HOST safe errno text still reports original native error once", async context => {
  const failure = Object.assign(new TypeError(secret), { code: "EACCES" });
  const seen: unknown[] = [];
  const { shell, fs } = fixture(context, [], { onInternalError(reason) { seen.push(reason); } });
  context.mock.method(fs, "access", () => { throw failure; });
  const result = await shell.exec("cat < /victim");
  assert.deepEqual(seen, [failure]);
  assert.equal(result.stderr, "shell: line 1: /victim: Permission denied\n");
});

test("HOST repeated occurrences are not deduplicated by value or retained", async context => {
  const failure = new TypeError(secret), seen: unknown[] = [];
  const { shell } = fixture(context, [{ name: "boom", async execute() { throw failure; } }], { onInternalError(reason) { seen.push(reason); } });
  await shell.exec("boom; boom");
  assert.deepEqual(seen, [failure, failure]);
});

test("HOST expr reports worker original while retaining safe existing status", async context => {
  const failure = new TypeError(secret), seen: unknown[] = [];
  const worker = Object.assign(new EventEmitter(), {
    postMessage() { queueMicrotask(() => worker.emit("error", failure)); },
    async terminate() { return 0; },
  });
  const executor = new RegexExecutor({ createWorker() { queueMicrotask(() => worker.emit("message", { ready: true })); return worker; } });
  context.after(() => executor.dispose());
  const { shell } = fixture(context, [createExprCommandWithExecutor(executor)], { onInternalError(reason) { seen.push(reason); } });
  const result = await shell.exec("expr x : x");
  assert.deepEqual(seen, [failure]);
  assert.equal(result.exitCode, 3);
  assert.equal(result.stderr, "expr: regex WORKER_ERROR: internal error\n");
});

for (const [index, failure] of [...failures, undefined].entries()) {
  test(`HOST original unknown reason ${index} reaches hook without serialization`, async context => {
    const seen: unknown[] = [];
    const { shell } = fixture(context, [{ name: "boom", async execute() { throw failure; } }], {
      onInternalError(reason) { seen.push(reason); },
    });
    const result = await shell.exec("boom");
    assert.equal(seen.length, 1);
    assert.ok(Object.is(seen[0], failure));
    assert.equal(result.stderr, opaque);
    assert.equal(result.exitCode, 1);
    assert.equal(Object.hasOwn(result, "internalErrors"), false);
  });
}

for (const source of ["cat /victim", "sed '' /victim", "awk '{print}' /victim", "tar -cf - /victim", "column /victim", "split /victim", "html-to-markdown /victim", "diff /victim /other", "tree /victim", "du /victim"] as const) {
  test(`HOST family reports original before formatting: ${source}`, async context => {
    const seen: unknown[] = [];
    const failure = new TypeError(secret);
    const { shell, fs } = fixture(context, [], { onInternalError(reason) { seen.push(reason); } });
    for (const method of ["access", "stat", "lstat", "readFile", "readStream", "openReadFile"] as const) {
      const original = fs[method];
      context.mock.method(fs, method, (...args: unknown[]) => {
        if (args[0] === "/victim") throw failure;
        return Reflect.apply(original, fs, args);
      });
    }
    await shell.exec(source);
    assert.deepEqual(seen, [failure]);
  });
}

test("HOST per-exec hook overrides constructor hook and follows nested dispatch", async context => {
  const inherited: unknown[] = [], selected: unknown[] = [];
  const failure = new TypeError(secret);
  const { shell } = fixture(context, [
    { name: "boom", async execute() { throw failure; } },
    { name: "nested", async execute(command) {
      assert.ok(command.invoke);
      return command.invoke("boom", []);
    } },
  ], { onInternalError(reason) { inherited.push(reason); } });
  await shell.exec("nested 2>&1 | copy", { onInternalError(reason) { selected.push(reason); } });
  assert.deepEqual(selected, [failure]);
  assert.deepEqual(inherited, []);
});

for (const mode of ["throw", "reject", "pending"] as const) {
  test(`HOST observer ${mode} does not change status or diagnostics or block settlement`, async context => {
    const failure = new TypeError(secret);
    let calls = 0;
    const { shell } = fixture(context, [{ name: "boom", async execute() { throw failure; } }], {
      onInternalError(reason) {
        calls++;
        assert.equal(reason, failure);
        if (mode === "throw") throw new Error("observer-private");
        if (mode === "reject") return Promise.reject(new Error("observer-private"));
        return new Promise<void>(() => {});
      },
    });
    const result = await shell.exec("boom; printf after");
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "after");
    assert.equal(result.stderr, opaque);
  });
}

test("HOST public diagnostics do not notify and their private cause is not promoted", async context => {
  const seen: unknown[] = [];
  const cause = new TypeError(secret);
  const failure = new FsError("EIO", { message: "public detail", cause });
  const { shell } = fixture(context, [{ name: "known", async execute() { throw failure; } }], { onInternalError(reason) { seen.push(reason); } });
  const result = await shell.exec("known; cat --bad-option");
  assert.deepEqual(seen, []);
  assert.equal(failure.cause, cause);
  assert.equal(result.stderr.includes("public detail"), true);
  assert.equal(result.stderr.includes(secret), false);
});

test("HOST caller cancellation and cleanup remain direct host failures, not observer events", async context => {
  const seen: unknown[] = [];
  const controller = new AbortController();
  const { shell } = fixture(context, [
    { name: "cancel", async execute() { controller.abort(false); throw new TypeError(secret); } },
    { name: "clean", async execute(command) {
      assert.ok(command.registerCleanup);
      command.registerCleanup(async () => { throw null; });
      return { exitCode: 0 };
    } },
  ], { onInternalError(reason) { seen.push(reason); } });
  await assert.rejects(shell.exec("cancel", { signal: controller.signal }), reason => reason === false);
  await assert.rejects(shell.exec("clean"), reason => reason === null);
  assert.deepEqual(seen, []);
});

test("HOST callback-triggered cancellation keeps caller falsey reason over callback throw", async context => {
  const controller = new AbortController();
  const failure = new TypeError(secret), seen: unknown[] = [];
  const { shell } = fixture(context, [{ name: "boom", async execute() { throw failure; } }], {
    onInternalError(reason) { seen.push(reason); controller.abort(0); throw new Error("observer-private"); },
  });
  await assert.rejects(shell.exec("boom", { signal: controller.signal }), reason => Object.is(reason, 0));
  assert.deepEqual(seen, [failure]);
});

for (const stage of ["createBudget", "makeFsModule", "run"] as const) {
  test(`HOST SafeJS ${stage} keeps original falsey or error identity`, async context => {
    const seen: unknown[] = [];
    const failure = stage === "run" ? null : new TypeError(secret);
    const runtime = { createBudget() { return {}; }, makeFsModule() { return {}; }, declareHostOperation(operation) { return operation; }, async run() { return { ok: true }; } } satisfies SafeJsRuntime<object>;
    runtime[stage] = () => { throw failure; };
    const { shell } = fixture(context, createSafeJsCommands({ runtime }), { onInternalError(reason) { seen.push(reason); } });
    const result = await shell.exec("safejs -e '1'");
    assert.deepEqual(seen, [failure]);
    assert.equal(result.stderr, "safejs: internal error\n");
  });
}
