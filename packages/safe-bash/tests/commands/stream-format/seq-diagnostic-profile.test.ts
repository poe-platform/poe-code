import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createFsFromVolume, Volume } from "memfs";
import ts from "typescript";

const profile = () => import("./seq-diagnostic-profile.js");
const matchingHost = { platform: "darwin", arch: "arm64", release: "25.4.0" };
const linuxHost = { platform: "linux", arch: "x64", release: "synthetic-linux" };
const formats = ["%f %f", "%g %e", "", "literal", "%%", "%%f", "%", "%%%", "%s", "%%%s", "%f %", "%f %s", "%f %% %g", "%f %%%", "%f %%", "%%%f%%"];
const extraFormats = new Set(["%f %f", "%g %e", "%f %", "%f %s", "%f %% %g", "%f %%%"]);
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const toolBytes = Buffer.from("synthetic seq identity; never executed");
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

async function setup(host = matchingHost) {
  const module = await profile();
  const evidence = readFileSync(new URL("./evidence/seq-diagnostic-initial.json", import.meta.url));
  assert.equal(evidence.length, 7752);
  assert.equal(digest(evidence), "328ece09cbb389ed2a95e42007b63e591826f7d1a8797bd2c38c414407a11ea6");
  const fixtures = JSON.parse(evidence.toString()) as { cases: { args: string[]; source: { exitCode: number; stdoutHex: string; stderr: string }; native: { exitCode: number; stdoutHex: string; stderr: string } }[] };
  const fileSystem = createFsFromVolume(Volume.fromJSON({
    [module.seqDiagnosticEvidencePath]: evidence,
    [module.seqDiagnosticOraclePath]: toolBytes,
  }));
  fileSystem.chmodSync(module.seqDiagnosticOraclePath, 0o755);
  const calls: { path: string; args: readonly string[]; options: unknown }[] = [];
  const reads: string[] = [];
  const state = { created: 0, disposed: 0, candidateCalls: 0, mutateCandidate: (_result: { exitCode: number; stdoutBytes: Buffer; stderrBytes: Buffer; stderr: string }) => {} };
  const dependencies = {
    fileSystem: fileSystem as unknown as typeof import("node:fs"),
    host: () => host,
    digest: (bytes: Uint8Array) => Buffer.from(bytes).equals(toolBytes) ? module.seqDiagnosticOracleHash : digest(bytes),
    spawn: (path: string, args: readonly string[], options: unknown) => {
      calls.push({ path, args: [...args], options });
      if (args[0] === "--version") return { status: 0, signal: null, stdout: Buffer.from("seq (GNU coreutils) 9.7\nsynthetic\n"), stderr: Buffer.alloc(0) };
      const fixture = fixtures.cases.find(item => JSON.stringify(item.args) === JSON.stringify(args));
      assert(fixture);
      return { status: fixture.native.exitCode, signal: null, stdout: Buffer.from(fixture.native.stdoutHex, "hex"), stderr: Buffer.from(fixture.native.stderr) };
    },
  };
  const originalLstat = fileSystem.lstatSync.bind(fileSystem);
  fileSystem.lstatSync = ((path: string, ...args: unknown[]) => {
    reads.push(String(path));
    return Reflect.apply(originalLstat, fileSystem, [path, ...args]);
  }) as typeof fileSystem.lstatSync;
  const shell = () => {
    state.created++;
    return {
      exec: async (command: string) => {
        state.candidateCalls++;
        const fixture = fixtures.cases.find(item => ["seq", ...item.args.map(quote)].join(" ") === command);
        assert(fixture);
        const format = fixture.args[1]!;
        const stderr = extraFormats.has(format) ? `seq: format '${format}' has too many % directives\n` : fixture.source.stderr;
        const result = { exitCode: fixture.source.exitCode, stdoutBytes: Buffer.from(fixture.source.stdoutHex, "hex"), stderrBytes: Buffer.from(stderr), stderr };
        state.mutateCandidate(result);
        return result;
      },
      dispose: async () => { await Promise.resolve(); state.disposed++; },
    };
  };
  return { module, fileSystem, evidence, fixtures, calls, reads, state, dependencies, shell, oracle: module.createSeqDiagnosticOracle(dependencies) };
}

interface ProjectedContext {
  skip(reason: string): void;
  diagnostic(message: string): void;
  test(name: string, body: (context: ProjectedContext) => Promise<void>): Promise<void>;
}
interface ProjectedNode { name: string; failed: boolean; error?: unknown; skipped?: string; children: ProjectedNode[] }

async function projection(input: Awaited<ReturnType<typeof setup>>, oracle = input.oracle) {
  const declarations: { name: string; body: (context: ProjectedContext) => Promise<void> }[] = [];
  const register = (name: string, body: (context: ProjectedContext) => Promise<void>) => { declarations.push({ name, body }); };
  const assertions = { portable: 0, native: 0 };
  const phase = new AsyncLocalStorage<"portable" | "native">();
  const countedAssert = Object.fromEntries(["equal", "deepEqual", "match"].map(name => [name, (...args: unknown[]) => {
    assertions[phase.getStore() ?? "portable"]++;
    return Reflect.apply(assert[name as "equal"], assert, args);
  }]));
  const imports: Record<string, unknown> = {
    "node:assert/strict": countedAssert,
    "node:test": register,
    "./helpers.js": { shell: input.shell, quote },
    "./seq-diagnostic-profile.js": { ...input.module, seqDiagnosticOracle: oracle },
  };
  const source = readFileSync(new URL("./seq-diagnostic.test.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const beforeReads = input.reads.length, beforeCalls = input.calls.length;
  new Function("require", "exports", "Buffer", compiled)((name: string) => {
    assert(Object.hasOwn(imports, name), `unapproved projected import: ${name}`);
    return imports[name];
  }, {}, Buffer);
  assert.equal(input.reads.length, beforeReads, "registration must not read fixtures or tools");
  assert.equal(input.calls.length, beforeCalls, "registration must not launch tools");
  const execute = async (name: string, body: (context: ProjectedContext) => Promise<void>, native = false): Promise<ProjectedNode> => {
    const node: ProjectedNode = { name, failed: false, children: [] };
    const pending: Promise<void>[] = [];
    const context: ProjectedContext = {
      skip: reason => { node.skipped = reason; },
      diagnostic: () => {},
      test: (childName, childBody) => {
        const work = execute(childName, childBody, true).then(child => { node.children.push(child); });
        pending.push(work);
        return work;
      },
    };
    try { await phase.run(native ? "native" : "portable", () => body(context)); }
    catch (error) { node.failed = true; node.error = error; }
    await Promise.all(pending);
    node.failed ||= node.children.some(child => child.failed);
    return node;
  };
  return {
    declarations,
    run: async () => {
      const nodes: ProjectedNode[] = [];
      for (const declaration of declarations) nodes.push(await execute(declaration.name, declaration.body));
      return { nodes, assertions, children: nodes.flatMap(node => node.children) };
    },
  };
}

test("seq diagnostic registration preserves all seventeen names without admission", async () => {
  const input = await setup();
  const projected = await projection(input);
  assert.deepEqual(projected.declarations.map(item => item.name), [
    "seq diagnostic oracle is pinned GNU 9.7 on Darwin arm64",
    ...formats.map(format => `seq diagnostic ${JSON.stringify(format)}: ${extraFormats.has(format) ? "identify extra directive operand" : "preserve negative distinction or escaped-percent output"}`),
  ]);
});

test("seq diagnostic Linux keeps sixteen portable rows and seventeen unavailable native units", async () => {
  const input = await setup(linuxHost);
  const result = await (await projection(input)).run();
  assert.equal(result.nodes.length, 17);
  assert.equal(result.children.length, 16);
  assert.equal(result.nodes.filter(node => node.skipped).length, 1);
  assert.equal(result.children.filter(node => node.skipped?.startsWith("UNAVAILABLE ")).length, 16);
  assert(result.nodes.every(node => !node.failed));
  assert.equal(result.assertions.portable, 56);
  assert.equal(result.assertions.native, 0);
  assert.equal(input.state.candidateCalls, 16);
  assert.equal(input.state.disposed, 16);
  assert.equal(input.calls.length, 0);
  assert(!input.reads.includes(input.module.seqDiagnosticOraclePath));
});

test("seq diagnostic architecture and kernel mismatch never read native bytes", async () => {
  for (const host of [{ ...matchingHost, arch: "x64" }, { ...matchingHost, release: "25.4.1" }]) {
    const input = await setup(host);
    assert.equal((await input.oracle.qualify()).status, "UNAVAILABLE");
    assert.equal((await input.oracle.native(["-f", "%f %%", "3"])).status, "UNAVAILABLE");
    assert.equal(input.reads.length, 0);
    assert.equal(input.calls.length, 0);
  }
});

test("seq diagnostic matching projection retains all portable and live assertions", async () => {
  const input = await setup();
  const result = await (await projection(input)).run();
  assert(result.nodes.every(node => !node.failed && !node.skipped));
  assert(result.children.every(node => !node.failed && !node.skipped));
  assert.deepEqual(result.assertions, { portable: 56, native: 64 });
  assert.equal(input.calls.filter(call => call.args[0] === "--version").length, 17);
  assert.equal(input.calls.filter(call => call.args[0] !== "--version").length, 16);
  assert.equal(input.state.disposed, 16);
});

test("seq diagnostic missing or wrong matching tool fails every native unit without hiding portable assertions", async () => {
  for (const missing of [true, false]) {
    const input = await setup();
    if (missing) input.fileSystem.unlinkSync(input.module.seqDiagnosticOraclePath);
    else input.fileSystem.writeFileSync(input.module.seqDiagnosticOraclePath, Buffer.alloc(toolBytes.length));
    const result = await (await projection(input)).run();
    assert.equal(result.nodes.length, 17);
    assert.equal(result.children.length, 16);
    assert.equal(result.children.filter(node => node.failed).length, 16);
    assert(result.nodes.every(node => node.failed && !node.skipped));
    assert.equal(result.assertions.portable, 56);
    assert.equal(input.state.disposed, 16);
    assert.equal(input.calls.length, 0);
  }
});

test("seq diagnostic native admission rejects links directories and non-executables", async () => {
  for (const mutation of ["link", "directory", "mode"]) {
    const input = await setup();
    const path = input.module.seqDiagnosticOraclePath;
    if (mutation === "mode") input.fileSystem.chmodSync(path, 0o644);
    else {
      input.fileSystem.unlinkSync(path);
      if (mutation === "link") input.fileSystem.symlinkSync(input.module.seqDiagnosticEvidencePath, path);
      else input.fileSystem.mkdirSync(path);
    }
    await assert.rejects(input.oracle.qualify());
    assert.equal(input.calls.length, 0);
  }
});

test("seq diagnostic version and launch failures cannot become unavailable", async () => {
  for (const changed of [
    { stdout: Buffer.from("seq (GNU coreutils) 9.70\n") },
    { status: 1 }, { status: null }, { signal: "SIGKILL" }, { error: false }, { error: 0 }, { error: "" },
  ]) {
    const input = await setup();
    const oracle = input.module.createSeqDiagnosticOracle({ ...input.dependencies, spawn: () => ({ status: 0, signal: null, stdout: Buffer.from("seq (GNU coreutils) 9.7\n"), stderr: Buffer.alloc(0), ...changed }) });
    await assert.rejects(oracle.qualify(), () => true);
    await assert.rejects(oracle.native(["-f", "%f %%", "3"]), () => true);
  }
});

test("seq diagnostic null and undefined native error fields mean no launch error", async () => {
  for (const error of [null, undefined]) {
    const input = await setup();
    const oracle = input.module.createSeqDiagnosticOracle({ ...input.dependencies, spawn: (...args) => ({ ...input.dependencies.spawn(...args), error }) });
    assert.equal((await oracle.qualify()).status, "ADMITTED");
  }
});

test("seq diagnostic actual row signals null status and falsey errors fail after good qualification", async () => {
  for (const changed of [{ status: null }, { signal: "SIGTERM" }, { error: false }, { error: 0 }, { error: "" }]) {
    const input = await setup();
    const oracle = input.module.createSeqDiagnosticOracle({ ...input.dependencies, spawn: (path, args, options) => ({ ...input.dependencies.spawn(path, args, options), ...(args[0] === "--version" ? {} : changed) }) });
    assert.equal((await oracle.qualify()).status, "ADMITTED");
    await assert.rejects(oracle.native(["-f", "%f %%", "3"]), () => true);
  }
});

test("seq diagnostic each launch rechecks identity and never inherits qualifier admission", async () => {
  const input = await setup();
  await input.oracle.qualify();
  input.fileSystem.writeFileSync(input.module.seqDiagnosticOraclePath, Buffer.alloc(toolBytes.length));
  await assert.rejects(input.oracle.native(["-f", "%f %%", "3"]));
  assert.equal(input.calls.length, 1);
  const second = await setup();
  const oracle = second.module.createSeqDiagnosticOracle({ ...second.dependencies, spawn: (...args) => {
    const result = second.dependencies.spawn(...args);
    second.fileSystem.writeFileSync(second.module.seqDiagnosticOraclePath, Buffer.alloc(toolBytes.length));
    return result;
  } });
  await assert.rejects(oracle.native(["-f", "%f %%", "3"]));
  assert.equal(second.calls.length, 1);
});

test("seq diagnostic subprocess options retain exact bounded clean C environment", async () => {
  const input = await setup();
  await input.oracle.native(["-f", "%f %%", "3"]);
  for (const call of input.calls) {
    assert.equal(call.path, input.module.seqDiagnosticOraclePath);
    assert.deepEqual(call.options, { env: { LC_ALL: "C" }, input: "", shell: false, timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
  }
});

test("seq diagnostic captured fixture corruption fails every host without losing declarations or children", async () => {
  for (const host of [linuxHost, matchingHost]) for (const corruption of ["missing", "size", "hash"]) {
    const input = await setup(host);
    if (corruption === "missing") input.fileSystem.unlinkSync(input.module.seqDiagnosticEvidencePath);
    else input.fileSystem.writeFileSync(input.module.seqDiagnosticEvidencePath, Buffer.alloc(corruption === "size" ? 1 : 7752));
    const result = await (await projection(input)).run();
    assert.equal(result.nodes.length, 17);
    assert.equal(result.children.length, 16);
    assert(result.nodes.every(node => node.failed && !node.skipped));
    assert(result.children.every(node => node.failed && !node.skipped));
    assert.equal(input.calls.length, 0);
  }
});

test("seq diagnostic portable status stdout and diagnostic failures remain failures on Linux", async () => {
  for (const mutation of ["status", "stdout", "stderr"]) {
    const input = await setup(linuxHost);
    input.state.mutateCandidate = result => {
      if (mutation === "status") result.exitCode = 42;
      else if (mutation === "stdout") result.stdoutBytes = Buffer.from("incorrect");
      else result.stderr = "incorrect";
    };
    const result = await (await projection(input)).run();
    assert.equal(result.nodes.slice(1).filter(node => node.failed).length, 16);
    assert.equal(result.children.length, 16);
    assert(result.children.every(node => node.skipped && !node.failed));
    assert.equal(input.state.disposed, 16);
  }
});

test("seq diagnostic changed native captures fail only the matching native phase", async () => {
  const input = await setup();
  const oracle = input.module.createSeqDiagnosticOracle({ ...input.dependencies, spawn: (path, args, options) => ({ ...input.dependencies.spawn(path, args, options), ...(args[0] === "--version" ? {} : { stdout: Buffer.from("drift") }) }) });
  const result = await (await projection(input, oracle)).run();
  assert.equal(result.children.filter(node => node.failed).length, 16);
  assert.equal(result.assertions.portable, 56);
  assert.equal(input.state.disposed, 16);
});

test("seq diagnostic native stderr byte differences are not hidden by UTF-8 replacement", async () => {
  const input = await setup();
  const malformed = Buffer.from([255]);
  input.fixtures.cases[14]!.native.stderr = malformed.toString();
  input.fixtures.cases[14]!.source.stderr = malformed.toString();
  const syntheticEvidence = Buffer.alloc(7752, 32);
  Buffer.from(JSON.stringify(input.fixtures)).copy(syntheticEvidence);
  input.fileSystem.writeFileSync(input.module.seqDiagnosticEvidencePath, syntheticEvidence);
  const oracle = input.module.createSeqDiagnosticOracle({
    ...input.dependencies,
    digest: bytes => Buffer.from(bytes).equals(syntheticEvidence) ? "328ece09cbb389ed2a95e42007b63e591826f7d1a8797bd2c38c414407a11ea6" : input.dependencies.digest(bytes),
    spawn: (path, args, options) => ({ ...input.dependencies.spawn(path, args, options), ...(args[1] === "%f %%" ? { stderr: malformed } : {}) }),
  });
  const result = await (await projection(input, oracle)).run();
  assert.equal(result.assertions.portable, 56);
  assert.equal(result.children.filter(node => node.failed).length, 1);
});

test("seq diagnostic read failures preserve falsey reasons and close the owned descriptor", async () => {
  for (const primary of [undefined, null, false, 0, ""]) {
    const input = await setup();
    let closes = 0;
    const close = input.fileSystem.closeSync.bind(input.fileSystem);
    input.fileSystem.fstatSync = (() => { throw primary; }) as typeof input.fileSystem.fstatSync;
    input.fileSystem.closeSync = descriptor => { close(descriptor); closes++; throw false; };
    await assert.rejects(input.oracle.qualify(), error => {
      assert(error instanceof AggregateError);
      assert.deepEqual(error.errors, [primary, false]);
      return true;
    });
    assert.equal(closes, 1);
    assert.equal(input.calls.length, 0);
  }
});

test("seq diagnostic candidate failure keeps children and awaits disposal", async () => {
  const input = await setup(linuxHost);
  let completed = 0;
  input.shell = () => ({ exec: async () => { throw false; }, dispose: async () => { await Promise.resolve(); completed++; } });
  const result = await (await projection(input)).run();
  assert.equal(result.children.length, 16);
  assert(result.nodes.slice(1).every(node => node.failed && node.error === false));
  assert.equal(completed, 16);
});

test("seq diagnostic candidate and cleanup errors retain falsey primary and secondary reasons", async () => {
  const module = await profile();
  for (const primary of [undefined, null, false, 0, ""]) for (const cleanup of [undefined, null, false, 0, ""]) {
    let closed = false;
    try {
      await module.observeSeqDiagnosticCandidate({ exec: async () => { throw primary; }, dispose: async () => { await Promise.resolve(); closed = true; throw cleanup; } }, "seq");
      assert.fail("must reject");
    } catch (error) {
      assert(error instanceof AggregateError);
      assert.deepEqual(error.errors, [primary, cleanup]);
      assert(closed);
    }
  }
});

test("seq diagnostic primary-only and cleanup-only rejection identities are preserved", async () => {
  const module = await profile();
  for (const reason of [undefined, null, false, 0, "", new Error("primary")]) for (const primary of [true, false]) {
    let closed = false, rejected = false;
    try {
      await module.observeSeqDiagnosticCandidate({
        exec: async () => { if (primary) throw reason; return { exitCode: 0, stdoutBytes: Buffer.alloc(0), stderrBytes: Buffer.alloc(0), stderr: "" }; },
        dispose: async () => { closed = true; if (!primary) throw reason; },
      }, "seq");
    } catch (error) { rejected = true; assert.equal(error, reason); }
    assert(rejected); assert(closed);
  }
});

test("seq diagnostic successful candidate bytes are owned across awaited cleanup", async () => {
  const module = await profile();
  const bytes = Buffer.from("original");
  const actual = await module.observeSeqDiagnosticCandidate({
    exec: async () => ({ exitCode: 0, stdoutBytes: bytes, stderrBytes: Buffer.alloc(0), stderr: "" }),
    dispose: async () => { await Promise.resolve(); bytes.fill(120); },
  }, "seq");
  assert.equal(Buffer.from(actual.stdoutBytes).toString(), "original");
});
