import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { makeSafeJsFsModule, makeSafeJsShellModule } from "../../../src/integrations/safejs/index.js";
import type { ShellHostOperation } from "../../../src/integrations/safejs/index.js";
import { record } from "../../../src/integrations/safejs/values.js";
import { StubFileSystem } from "./stub-filesystem.js";

const localRoot = process.env.SAFEJS_LOCAL_ROOT;
const skip = localRoot === undefined ? "Set SAFEJS_LOCAL_ROOT to an existing poe-code/packages/safejs checkout" : false;

type HostFunction = (...args: unknown[]) => unknown;

function hostFunction(value: unknown): value is HostFunction {
  return typeof value === "function";
}

async function loadFunction(path: string, name: string): Promise<HostFunction> {
  const imported: unknown = await import(pathToFileURL(path).href);
  if (typeof imported !== "object" || imported === null) throw new TypeError("Invalid local SafeJS module");
  const candidate: unknown = Reflect.get(imported, name);
  if (!hostFunction(candidate)) throw new TypeError(`Missing SafeJS function: ${name}`);
  return candidate;
}

async function localSafeJs() {
  if (localRoot === undefined) throw new Error("SAFEJS_LOCAL_ROOT is required");
  const [run, makeFsModule, declare, dump, restore, readHostOperationPolicy] = await Promise.all([
    loadFunction(join(localRoot, "src/run.ts"), "run"),
    loadFunction(join(localRoot, "src/modules/fs.ts"), "makeFsModule"),
    loadFunction(join(localRoot, "src/interp/host-bridge.ts"), "declareHostOperation"),
    loadFunction(join(localRoot, "src/dump.ts"), "dump"),
    loadFunction(join(localRoot, "src/restore.ts"), "restore"),
    loadFunction(join(localRoot, "src/interp/host-bridge.ts"), "readHostOperationPolicy"),
  ]);
  return {
    run, makeFsModule, dump, restore, readHostOperationPolicy,
    declareHostOperation(operation: ShellHostOperation, policy: "read-side-effect"): ShellHostOperation {
      assert.equal(declare(operation, policy), operation);
      return operation;
    },
  };
}

function successful(value: unknown): Record<string, unknown> {
  const result = record(value, "run result");
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

test("real SafeJS: shell and fs share one VFS; stats/dirents cross as guest-safe values", { skip }, async () => {
  const safejs = await localSafeJs();
  const fs = new StubFileSystem({ "/data/original": "original" });
  const controller = new AbortController();
  const shell = makeSafeJsShellModule(async (source, options) => {
    assert.equal(source, "copy virtual");
    assert.equal(options.signal, controller.signal);
    assert.equal(options.fs, fs);
    const bytes = await options.fs.readFile("/data/input", { signal: options.signal });
    await options.fs.writeFile("/data/output", bytes, { signal: options.signal });
    return { stdout: Buffer.from(bytes).toString(), stderr: "", exitCode: 0, hostObject: options.fs };
  }, { fs, signal: controller.signal, replayPolicy: "read-side-effect", declareHostOperation: safejs.declareHostOperation });
  const fsModule = record(makeSafeJsFsModule(safejs.makeFsModule, fs, { signal: controller.signal }), "fs module");
  assert.equal(safejs.readHostOperationPolicy(fsModule.readFile), "re-issue");
  const result = successful(await safejs.run([
    'import { readFile, writeFile, stat, readdir } from "fs";',
    'import { exec } from "shell";',
    'await writeFile("/data/input", "68656c6c6f", "hex");',
    'const result = await exec("copy virtual", { stdin: "input", env: { KEY: "value" } });',
    'const stats = await stat("/data/output");',
    'const entries = await readdir("/data", { withFileTypes: true });',
    'return JSON.stringify({ content: await readFile("/data/output", "utf8"), stdout: result.stdout, keys: Object.keys(result), size: stats.size, isFile: stats.isFile(), isDirectory: entries[0].isDirectory(), name: entries[0].name, parentPath: entries[0].parentPath });',
  ].join("\n"), {
    signal: controller.signal,
    modules: { fs: fsModule, shell },
  }));
  assert.equal(typeof result.returnValue, "string");
  if (typeof result.returnValue !== "string") throw new TypeError("Expected string result");
  assert.deepEqual(JSON.parse(result.returnValue), {
    content: "hello", stdout: "hello", keys: ["stdout", "stderr", "exitCode"],
    size: 5, isFile: true, isDirectory: false, name: "original", parentPath: "/data",
  });
  const snapshot = record(result.snapshot, "snapshot");
  assert.ok(Array.isArray(snapshot.hostCalls));
  const calls = snapshot.hostCalls.map((call: unknown) => record(call, "host call"));
  assert.ok(calls.some((call) => call.moduleId === "shell" && call.operation === "exec" && call.policy === "read-side-effect" && call.lifecycle === "consumed"));
  assert.ok(calls.some((call) => call.moduleId === "fs" && call.operation === "writeFile" && call.policy === "read-side-effect"));
});

test("real SafeJS: guest cannot select host fs, guest signals, or binary results", { skip }, async () => {
  const safejs = await localSafeJs();
  const fs = new StubFileSystem({ "/file": "body" });
  const controller = new AbortController();
  let executions = 0;
  const shell = makeSafeJsShellModule(() => { executions += 1; return { stdout: "", stderr: "", exitCode: 0 }; }, {
    fs, signal: controller.signal, replayPolicy: "read-side-effect", declareHostOperation: safejs.declareHostOperation,
  });
  const result = successful(await safejs.run([
    'import { readFile } from "fs";',
    'import { exec } from "shell";',
    'let failures = 0;',
    'try { await exec("bad", { signal: {} }); } catch (error) { failures += 1; }',
    'try { await readFile("/file"); } catch (error) { failures += 1; }',
    'try { await readFile("/etc/passwd", "utf8"); } catch (error) { if (error.code === "ENOENT") failures += 1; }',
    'return failures;',
  ].join("\n"), { modules: { fs: makeSafeJsFsModule(safejs.makeFsModule, fs), shell } }));
  assert.equal(result.returnValue, 3);
  assert.equal(executions, 0);
});

test("real SafeJS: cancellation reaches the executor only through explicit host wiring", { skip }, async () => {
  const safejs = await localSafeJs();
  const fs = new StubFileSystem();
  const controller = new AbortController();
  let notify: () => void = () => undefined;
  const started = new Promise<void>((resolve) => { notify = resolve; });
  let observedSignal: AbortSignal | undefined;
  const shell = makeSafeJsShellModule(async (_source, options) => {
    observedSignal = options.signal;
    notify();
    return new Promise(() => undefined);
  }, { fs, signal: controller.signal, replayPolicy: "read-side-effect", declareHostOperation: safejs.declareHostOperation });
  const pending = Promise.resolve(safejs.run('import { exec } from "shell"; await exec("slow");', {
    modules: { shell }, signal: controller.signal,
  }));
  const settled = pending.then((value) => ({ value }), (error: unknown) => ({ error }));
  await started;
  assert.equal(observedSignal, controller.signal);
  controller.abort();
  const outcome = await settled;
  if ("error" in outcome) {
    const error = outcome.error;
    assert.ok(typeof error === "object" && error !== null && "name" in error);
    assert.equal(error.name, "AbortError");
  } else assert.equal(record(outcome.value, "run result").ok, false);
  assert.equal(observedSignal.aborted, true);
});

test("real SafeJS: a pending effectful shell call requires reconciliation, never blind replay", { skip }, async () => {
  const safejs = await localSafeJs();
  const fs = new StubFileSystem();
  const controller = new AbortController();
  let executions = 0;
  let complete: (value: { stdout: string; stderr: string; exitCode: number }) => void = () => undefined;
  const waiting = new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => { complete = resolve; });
  const shell = makeSafeJsShellModule(async () => { executions += 1; return waiting; }, {
    fs, signal: controller.signal, replayPolicy: "read-side-effect", declareHostOperation: safejs.declareHostOperation,
  });
  const source = 'import { exec } from "shell"; const result = await exec("effect"); return result.stdout;';
  const pending = safejs.run(source, { modules: { shell }, signal: controller.signal });
  try {
    const serialized = await safejs.dump(pending);
    assert.equal(typeof serialized, "string");
    if (typeof serialized !== "string") throw new TypeError("Expected snapshot string");
    assert.equal(executions, 1);
    const snapshot = safejs.restore(JSON.parse(serialized), { source });
    await assert.rejects(Promise.resolve(safejs.run(source, { modules: { shell }, snapshot })), {
      name: "HostCallResumabilityError", action: "external-reconciliation",
    });
    assert.equal(executions, 1);
  } finally {
    complete({ stdout: "done", stderr: "", exitCode: 0 });
    successful(await pending);
  }
});

test("local SafeJS types: bridge, injected factories, declaration, and run modules are structurally assignable", { skip }, () => {
  if (localRoot === undefined) throw new Error("SAFEJS_LOCAL_ROOT is required");
  const probePath = join(import.meta.dirname, "local-safejs-type-probe.ts");
  const source = [
    `import { makeFsModule, type FsImplementation } from ${JSON.stringify(join(localRoot, "src/modules/fs.js"))};`,
    `import { declareHostOperation } from ${JSON.stringify(join(localRoot, "src/interp/host-bridge.js"))};`,
    `import { run } from ${JSON.stringify(join(localRoot, "src/run.js"))};`,
    'import { createNodeFsBridge, makeSafeJsFsModule, makeSafeJsShellModule } from "../../../src/integrations/safejs/index.js";',
    'import { StubFileSystem } from "./stub-filesystem.js";',
    'const fs = new StubFileSystem();',
    'const signal = new AbortController().signal;',
    'const implementation: FsImplementation = createNodeFsBridge(fs, { signal });',
    'const fsModule = makeSafeJsFsModule(makeFsModule, fs, { signal });',
    'const shell = makeSafeJsShellModule(async () => ({stdout: "", stderr: "", exitCode: 0}), { fs, signal, replayPolicy: "read-side-effect", declareHostOperation });',
    'void run("return 1;", { signal, modules: { fs: fsModule, shell } });',
    'void implementation;',
  ].join("\n");
  const options: ts.CompilerOptions = {
    noEmit: true, strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true, types: ["node"],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (path) => path === probePath || fileExists(path);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => path === probePath
    ? ts.createSourceFile(path, source, languageVersion, true)
    : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([probePath], options, host);
  const probe = program.getSourceFile(probePath);
  assert.ok(probe);
  const diagnostics = [...program.getSyntacticDiagnostics(probe), ...program.getSemanticDiagnostics(probe)];
  assert.deepEqual(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);
});

test("real SafeJS plus concrete Shell and MemoryFileSystem: stdin, pipes, and shared writes", { skip, timeout: 5000 }, async () => {
  const safejs = await localSafeJs();
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  const executor = new Shell({ fs });
  executor.register({
    name: "relay",
    async execute(context) {
      for await (const bytes of context.stdin) await context.stdout.write(bytes);
      return { exitCode: 0 };
    },
  });
  const shell = makeSafeJsShellModule(executor, {
    fs, signal: controller.signal, replayPolicy: "read-side-effect", declareHostOperation: safejs.declareHostOperation,
  });
  const result = successful(await safejs.run([
    'import { readFile } from "fs";',
    'import { exec } from "shell";',
    'const result = await exec("relay | relay > /output", { stdin: "real pipeline" });',
    'return JSON.stringify({ exitCode: result.exitCode, content: await readFile("/output", "utf8") });',
  ].join("\n"), {
    signal: controller.signal,
    modules: { fs: makeSafeJsFsModule(safejs.makeFsModule, fs, { signal: controller.signal }), shell },
  }));
  assert.equal(result.returnValue, JSON.stringify({ exitCode: 0, content: "real pipeline" }));
});
