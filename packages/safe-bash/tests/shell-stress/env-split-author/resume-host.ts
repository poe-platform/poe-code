import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Shell, ShellLimitError, FsError, agentCommands, createMemoryFileSystem, pipeBytes, writeBytes, writeText } from "../../../src/index.js";
import type { ByteSource, ShellExecOptions } from "../../../src/index.js";

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const batch = process.argv[2] === "--batch";
const selected = batch ? process.argv.slice(3) : [process.argv[2]];
if (batch) {
  const finite = new Set([
    "real-nested-pipeline", "export-local-cwd-parent", "prefix-assignment-before-clear", "binary-cursor-origin",
    "supplied-empty-origin", "bom-stderr-stdout", "parse-before-chdir-effects", "unsupported-before-chdir",
    "literal-single-optional-argument", "literal-injection-host-boundary", "fallback-keeps-context", "same-stream-split-does-not-consume",
  ]);
  assert.ok(selected.length > 0 && selected.length <= 4 && selected.every(scenario => scenario !== undefined && finite.has(scenario)), "Invalid finite env split batch");
}

async function runScenario(scenario: string | undefined): Promise<void> {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.mkdir("/other");
  const shell = new Shell({ fs, cwd: "/work", env: { PUBLIC: "parent value", A: "ancestor", PATH: "" } }).use(agentCommands());
  const calls: string[] = [];
  let entered = 0;
  shell.use(async (context, next) => { calls.push(context.command); return next(); });
  shell.register({ name: "report", async execute(context) {
    entered++;
    await writeText(context.stdout, JSON.stringify({ env: context.env, args: context.args, cwd: context.cwd, origin: context.stdinIsDefault }) + "\n");
    return { exitCode: 0 };
  } });
  shell.register({ name: "emit", async execute(context) {
    entered++;
    await writeText(context.stdout, "abcd");
    return { exitCode: 0 };
  } });
  const failures: unknown[] = [];
  const unhandled = (error: unknown) => { failures.push(error); };
  process.on("unhandledRejection", unhandled);

  try {
    if (scenario === "real-nested-pipeline") {
      const result = await shell.exec("env -S '-i A=1 B=2 env -S \"-u A env\"' | cat");
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "B=2\n", ""]);
      assert.equal(calls.filter(name => name === "env").length, 3);
      assert.ok(calls.includes("cat"));
    } else if (scenario === "export-local-cwd-parent") {
      const result = await shell.exec("SECRET=private; f(){ local INNER=local; env -S '-i -C /other PWD=caller report ${PUBLIC} ${SECRET} ${INNER}'; printf '%s|%s|%s\\n' \"$SECRET\" \"$INNER\" \"$PWD\"; }; f; report");
      assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
      const lines = result.stdout.trimEnd().split("\n");
      assert.deepEqual(JSON.parse(lines[0]!), { env: { PWD: "caller" }, args: ["parent value"], cwd: "/other", origin: true });
      assert.equal(lines[1], "private|local|/work");
      assert.deepEqual(JSON.parse(lines[2]!), { env: { PUBLIC: "parent value", A: "ancestor", PATH: "", PWD: "/work" }, args: [], cwd: "/work", origin: true });
      assert.equal(entered, 2);
    } else if (scenario === "prefix-assignment-before-clear") {
      const result = await shell.exec("PUBLIC=prefix env -S '-i KEEP=${PUBLIC} report ${PUBLIC}'");
      assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
      assert.deepEqual(JSON.parse(result.stdout), { env: { KEEP: "prefix" }, args: ["prefix"], cwd: "/work", origin: true });
      assert.equal(entered, 1);
    } else if (scenario === "binary-cursor-origin") {
      const bytes = Uint8Array.from([0, 255, 239, 187, 191, 10]);
      let origin: boolean | undefined;
      shell.register({ name: "forward", async execute(context) {
        const iterator = context.stdin[Symbol.asyncIterator]();
        assert.deepEqual((await iterator.next()).value, Uint8Array.of(7));
        return context.invoke!("env", ["-S", "-i binary"], { stdin: context.stdin, stdinIsDefault: context.stdinIsDefault ?? true });
      } });
      shell.register({ name: "binary", async execute(context) {
        entered++; origin = context.stdinIsDefault;
        assert.deepEqual({ ...context.env }, {});
        await pipeBytes(context.stdin, context.stdout, context.signal);
        return { exitCode: 0 };
      } });
      const stdin: ByteSource = (async function* () { yield Uint8Array.of(7); yield bytes; })();
      const result = await shell.exec("forward | cat", { stdin });
      assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, bytes); assert.equal(origin, false); assert.equal(entered, 1);
    } else if (scenario === "supplied-empty-origin") {
      const result = await shell.exec("env -S '-i report'", { stdin: new Uint8Array() });
      assert.equal(result.exitCode, 0);
      assert.deepEqual(JSON.parse(result.stdout), { env: {}, args: [], cwd: "/work", origin: false });
      assert.equal(entered, 1);
    } else if (scenario === "bom-stderr-stdout") {
      const bytes = Uint8Array.from([239, 187, 191, 65, 0, 255]);
      shell.register({ name: "binary", async execute(context) {
        entered++; await writeBytes(context.stdout, bytes, context.signal); await writeBytes(context.stderr, bytes, context.signal);
        return { exitCode: 0 };
      } });
      const result = await shell.exec("env -S binary");
      assert.equal(result.exitCode, 0); assert.equal(entered, 1);
      assert.deepEqual(result.stdoutBytes, bytes); assert.deepEqual(result.stderrBytes, bytes);
      assert.equal(result.stdout.codePointAt(0), 0xfeff); assert.equal(result.stderr.codePointAt(0), 0xfeff);
    } else if (scenario === "parse-before-chdir-effects") {
      const result = await shell.exec("env -C /missing -S 'report ${9BAD}'");
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [125, "", "env: only ${VARNAME} expansion is supported, error at: ${9BAD}\n"]);
      assert.equal(entered, 0); assert.deepEqual(calls, ["env"]);
      assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), []);
    } else if (scenario === "unsupported-before-chdir") {
      const result = await shell.exec("env -C /missing -S '--argv0=unsafe report'");
      assert.equal(result.exitCode, 2); assert.equal(result.stdout, "");
      assert.equal(result.stderr, "env: unrecognized option '--argv0=unsafe'\n");
      assert.equal(entered, 0); assert.deepEqual(calls, ["env"]);
    } else if (scenario === "literal-single-optional-argument") {
      await fs.writeFile("/work/script", Buffer.from("#!/usr/bin/env bash -e\nprintf forbidden > marker\n"), { mode: 0o755 });
      const result = await shell.exec("./script");
      assert.equal(result.exitCode, 127); assert.equal(result.stdout, "");
      assert.equal(result.stderr, "env: bash -e: command not found\n");
      assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["script"]);
      assert.deepEqual(Buffer.from(await fs.readFile("/work/script")), Buffer.from("#!/usr/bin/env bash -e\nprintf forbidden > marker\n"));
    } else if (scenario === "literal-injection-host-boundary") {
      const value = "/bin/sh -c touch marker; $(touch marker) `touch marker`";
      const result = await shell.exec(`env -S ${quote("report ${VALUE}")}`, { env: { VALUE: value } });
      assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
      assert.deepEqual(JSON.parse(result.stdout).args, [value]);
      assert.deepEqual(calls, ["env", "report"]); assert.equal(entered, 1);
      assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), []);
    } else if (scenario === "shared-command-budget") {
      await assert.rejects(shell.exec("env -S emit", { limits: { maxCommands: 1 } }), error => error instanceof ShellLimitError && error.limit === "maxCommands");
      assert.equal(entered, 0); assert.deepEqual(calls, ["env"]);
    } else if (scenario === "shared-output-budget") {
      const okay = await shell.exec("env -S emit", { limits: { maxOutputBytes: 4 } });
      assert.deepEqual([okay.exitCode, okay.stdout, okay.stderr], [0, "abcd", ""]); assert.equal(entered, 1);
      await assert.rejects(shell.exec("env -S emit", { limits: { maxOutputBytes: 3 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
      assert.equal(entered, 2);
    } else if (scenario === "shared-depth-budget") {
      await assert.rejects(shell.exec("env -S 'env -S \"env -S emit\"'", { limits: { maxSubstitutionDepth: 2 } }), error => error instanceof ShellLimitError && error.limit === "maxSubstitutionDepth");
      assert.equal(entered, 0); assert.ok(calls.filter(name => name === "env").length >= 2);
    } else if (scenario === "shared-source-budget") {
      const body = "printf é";
      const source = `env -S ${quote(`bash -c '${body}'`)}`;
      await assert.rejects(shell.exec(source, { limits: { maxSourceBytes: Buffer.byteLength(source) + Buffer.byteLength(body) - 1 } }), error => error instanceof ShellLimitError && error.limit === "maxSourceBytes");
      assert.ok(calls.includes("bash"));
    } else if (scenario === "shared-loop-budget") {
      await assert.rejects(shell.exec("env -S 'bash -c \"while true; do :; done\"'", { limits: { maxLoopIterations: 2 } }), error => error instanceof ShellLimitError && error.limit === "maxLoopIterations");
      assert.ok(calls.includes("bash"));
    } else if (scenario === "split-byte-cap" || scenario === "split-argument-cap" || scenario === "split-recursion-cap") {
      const source = scenario === "split-byte-cap" ? "env -S 'report ${BIG}'" : scenario === "split-argument-cap" ? `env -S ${quote(`report ${"x ".repeat(10001)}`)}` : "env -S '${LOOP}'";
      const env = { BIG: "🙂".repeat(40000), LOOP: "-S ${LOOP}" };
      const result = await shell.exec(source, { env });
      assert.equal(result.exitCode, 125); assert.equal(result.stdout, "");
      assert.match(result.stderr, /env: split-string (?:byte|argument|expansion|work) limit exceeded/u);
      assert.equal(entered, 0); assert.deepEqual(calls, ["env"]);
    } else if (scenario === "typed-cancel-cleanup-late-reject") {
      const controller = new AbortController();
      const reason = new FsError("EACCES", { path: "author cancellation" });
      let cleaned = 0;
      let cleanup: Promise<void> | undefined;
      shell.register({ name: "late", async execute(context) {
        entered++;
        const close = () => cleanup ??= delay(15).then(() => { cleaned++; });
        context.registerCleanup!(close);
        setTimeout(() => controller.abort(reason), 1);
        try { await delay(10); throw new Error("observed losing handler failure"); }
        finally { await close(); }
      } });
      await assert.rejects(shell.exec("env -S '-i late'", { signal: controller.signal }), error => error === reason);
      assert.equal(entered, 1); assert.equal(cleaned, 1);
      await delay(25);
    } else if (scenario === "cleanup-failure-identity") {
      const reason = new Error("registered child cleanup failure");
      shell.register({ name: "cleanup-fail", execute(context) {
        entered++; context.registerCleanup!(() => { throw reason; }); return { exitCode: 0 };
      } });
      await assert.rejects(shell.exec("env -S cleanup-fail"), error => error === reason);
      assert.equal(entered, 1);
    } else if (scenario === "preabort-no-dispatch") {
      const controller = new AbortController();
      const reason = Object.freeze({ kind: "preabort" }); controller.abort(reason);
      await assert.rejects(shell.exec("env -S emit", { signal: controller.signal }), error => error === reason);
      assert.equal(entered, 0); assert.deepEqual(calls, []);
    } else if (scenario === "blocked-input-cancel") {
      const controller = new AbortController();
      const reason = new Error("input cancellation");
      let reads = 0;
      const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
        next() {
          reads++; setTimeout(() => controller.abort(reason), 1);
          return new Promise<IteratorResult<Uint8Array>>((resolve, reject) => { setTimeout(() => reject(new Error("late input rejection")), 10); });
        },
        async return() { return { done: true as const, value: undefined }; },
      }; } };
      await assert.rejects(shell.exec("env -S cat", { stdin, signal: controller.signal }), error => error === reason);
      assert.equal(reads, 1); assert.ok(calls.includes("cat")); await delay(25);
    } else if (scenario === "fallback-keeps-context") {
      shell.register({ name: "fallback", execute(context) {
        const { invoke, ...withoutInvoke } = context;
        assert.equal(typeof invoke, "function");
        return shell.commands.get("env")!.execute({ ...withoutInvoke, command: "env", args: ["-S", "-i report empty"] });
      } });
      const result = await shell.exec("fallback");
      assert.equal(result.exitCode, 0); assert.equal(result.stderr, ""); assert.equal(entered, 1);
      assert.deepEqual(JSON.parse(result.stdout), { env: {}, cwd: "/work", origin: true, args: ["empty"] });
    } else if (scenario === "sink-cancel-precedence") {
      const controller = new AbortController();
      const reason = new Error("caller wins sink failure");
      const options: ShellExecOptions = { signal: controller.signal, stdout: { write() {
        controller.abort(reason); throw new Error("downstream failure");
      } } };
      await assert.rejects(shell.exec("env -S emit", options), error => error === reason);
      assert.equal(entered, 1);
    } else if (scenario === "same-stream-split-does-not-consume") {
      let reads = 0;
      const stdin: ByteSource = (async function* () { reads++; yield Uint8Array.of(65); })();
      const result = await shell.exec("env -S report", { stdin });
      assert.equal(result.exitCode, 0); assert.equal(entered, 1); assert.equal(reads, 0);
    } else {
      throw new Error(`Unknown host scenario ${scenario}`);
    }
    assert.deepEqual(failures, []);
    console.log(JSON.stringify({ scenario, passed: true }));
  } finally {
    await shell.dispose();
    process.off("unhandledRejection", unhandled);
  }
}

for (const scenario of selected) {
  try {
    await runScenario(scenario);
  } catch (error) {
    if (batch) console.error("ENV_SPLIT_BATCH_FAILURE " + JSON.stringify({ scenario }));
    throw error;
  }
}
