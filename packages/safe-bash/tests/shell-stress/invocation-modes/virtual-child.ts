import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CommandRegistry, FsError, pipeBytes, toByteSource, writeText } from "../../../src/contracts/index.js";
import type { ByteSource, FileSystem } from "../../../src/contracts/index.js";
import { createStandardCommands } from "../../../src/commands/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell, ShellLimitError } from "../../../src/shell/index.js";
import type { ShellLimits } from "../../../src/shell/index.js";
import { cases } from "./cases.js";
import { fixtureBytes, inputBytes } from "./harness.js";

async function setup() {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const commands = new CommandRegistry(createStandardCommands());
  const shell = new Shell({ fs, commands, cwd: "/work", env: { PATH: "base", HOME: "/nonexistent", LC_ALL: "C", LANG: "C", TZ: "UTC" } });
  return { fs, commands, shell };
}

export async function differential(id: string) {
  const row = cases.find(candidate => candidate.id === id);
  assert.ok(row, id);
  const { fs, shell } = await setup();
  const outcome = await (async () => {
    const renderedFixtures = [];
    for (const fixture of row.fixtures ?? []) {
      const path = `/work/${fixture.path}`;
      await fs.mkdir(dirname(path), { recursive: true });
      if (fixture.directory) await fs.mkdir(path, { recursive: true });
      else if (fixture.link) await fs.symlink(fixture.link, path);
      else {
        const bytes = fixtureBytes(fixture, "/bin/bash");
        await fs.writeFile(path, bytes, { mode: fixture.mode ?? 0o644 });
        renderedFixtures.push({ path, hex: bytes.toString("hex"), mode: fixture.mode ?? 0o644 });
      }
    }
    for (const fixture of row.fixtures ?? []) if (fixture.mode !== undefined && fixture.directory) await fs.chmod(`/work/${fixture.path}`, fixture.mode);
    const input = inputBytes(row);
    const stdin = (async function* (): AsyncGenerator<Uint8Array> {
      for (let offset = 0; offset < input.length; offset += row.chunkBytes ?? input.length) yield input.subarray(offset, offset + (row.chunkBytes ?? input.length));
    })();
    const result = await shell.exec(row.source, { stdin });
    const effects: Record<string, string> = {};
    for (const path of ["effect", "fd-output"]) {
      try { effects[path] = Buffer.from(await fs.readFile(`/work/${path}`)).toString("hex"); } catch (error) { if (!(error instanceof FsError) || error.code !== "ENOENT") throw error; }
    }
    return { id, exitCode: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex"), stdout: result.stdout, stderr: result.stderr, effects, renderedFixtures };
  })().then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
  try { await shell.dispose(); }
  catch (error) { if (outcome.ok) throw error; }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

export async function differentialBatch(ids: readonly string[]) {
  assert.ok(ids.length > 0 && ids.length <= 8, "Differential batch requires 1..8 rows");
  assert.equal(new Set(ids).size, ids.length, "Duplicate differential batch ID");
  for (const id of ids) assert.ok(cases.some(row => row.id === id), `Unknown differential batch ID: ${id}`);
  const rows = [];
  for (const id of ids) rows.push(await differential(id));
  return rows;
}

async function host(id: string) {
  const { fs, commands, shell } = await setup();
  const seen: unknown[] = [];
  const origin: unknown[] = [];
  commands.register({ name: "inspect", async execute(context) {
    origin.push(context.stdinIsDefault);
    await pipeBytes(context.stdin, context.stdout, context.signal);
    return { exitCode: 0 };
  } });
  commands.register({ name: "relay", async execute(context) {
    assert.ok(context.invoke);
    return context.invoke("bash", ["-c", 'inspect; printf "%s:%s\\n" "$0" "$1"', "literal name", "*;empty" ]);
  } });
  if (id === "host-nested-invoke-middleware-origin") {
    shell.use(async (context, next) => { seen.push(context.command); return next(); });
    const result = await shell.exec("relay", { stdin: toByteSource("bytes\n") });
    assert.equal(result.stdout, "bytes\nliteral name:*;empty\n");
    assert.deepEqual(origin, [false]);
    assert.deepEqual(seen, ["relay", "bash", "inspect", "printf"]);
  } else if (id === "host-origin-default-and-replacement") {
    await shell.exec("bash -c inspect");
    commands.register({ name: "replaceinput", async execute(context) {
      assert.ok(context.invoke);
      await context.invoke("sh", ["-c", "inspect"], { stdin: toByteSource("") });
      return context.invoke("bash", ["-c", "inspect"], { stdin: toByteSource(""), stdinIsDefault: true });
    } });
    await shell.exec("replaceinput");
    assert.deepEqual(origin, [true, false, true]);
  } else if (id === "host-registry-interpreter-precedence") {
    for (const name of ["bash", "sh", "invtool"]) commands.register({ name, async execute(context) { await writeText(context.stdout, `registry:${name}\n`); return { exitCode: 0 }; } });
    const result = await shell.exec("bash -c false; sh -s; PATH=missing invtool");
    assert.equal(result.stdout, "registry:bash\nregistry:sh\nregistry:invtool\n");
  } else if (id === "host-path-permission-capability") {
    await fs.writeFile("/work/tool", Buffer.from("#!/bin/bash\nprintf 'never\\n'\n"), { mode: 0o755 });
    const unknown = new Proxy(fs, { get(target, property) {
      if (property === "capabilities") return { ...target.capabilities, permissions: false };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } }) as FileSystem;
    const result = await shell.exec("PATH='' tool", { fs: unknown });
    assert.equal(result.exitCode, 126);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /tool/u);
  } else if (id === "host-no-startup-host-fallback") {
    await fs.writeFile("/work/startup", Buffer.from("printf 'STARTUP-LEAK\\n'\n"));
    const result = await shell.exec("bash -c 'printf child'; sh -c 'printf child'; PATH=/bin:/usr/bin uname", { env: { BASH_ENV: "/work/startup", ENV: "/work/startup" } });
    assert.equal(result.stdout, "childchild");
    assert.equal(result.exitCode, 127);
    assert.match(result.stderr, /uname/u);
  } else if (id === "host-middleware-denies-path-before-io") {
    let accesses = 0;
    const guarded = new Proxy(fs, { get(target, property) {
      if (property === "stat" || property === "access" || property === "readFile") return async () => { accesses++; throw new Error("forbidden lookup"); };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } }) as FileSystem;
    shell.use(async (context, next) => context.command === "invtool" ? { exitCode: 73 } : next());
    const result = await shell.exec("PATH=tools invtool", { fs: guarded });
    assert.equal(result.exitCode, 73);
    assert.equal(accesses, 0);
  } else if (id === "host-cancel-body-late-rejection") {
    const controller = new AbortController();
    const reason = new FsError("ENOENT", { path: "caller-reason" });
    let entered = false;
    commands.register({ name: "late", execute(context) {
      entered = true;
      assert.equal(context.signal.aborted, false);
      setTimeout(() => controller.abort(reason), 5);
      return new Promise((_accept, reject) => setTimeout(() => reject(new Error("observed late rejection")), 35));
    } });
    await assert.rejects(shell.exec("bash -c late", { signal: controller.signal }), error => error === reason);
    assert.equal(entered, true);
    await new Promise(accept => setTimeout(accept, 60));
  } else if (id === "host-cancel-path-late-rejection") {
    const controller = new AbortController();
    const reason = new FsError("EACCES", { path: "caller-reason" });
    let entered = false;
    const delayed = new Proxy(fs, { get(target, property) {
      if (property === "stat") return (_path: string, options: { signal?: AbortSignal }) => {
        assert.ok(options.signal);
        entered = true;
        setTimeout(() => controller.abort(reason), 5);
        return new Promise((_accept, reject) => setTimeout(() => reject(new Error("late stat")), 35));
      };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } }) as FileSystem;
    await assert.rejects(shell.exec("PATH=tools invtool", { fs: delayed, signal: controller.signal }), error => error === reason);
    assert.equal(entered, true);
    await new Promise(accept => setTimeout(accept, 60));
  } else if (id.startsWith("host-budget-")) {
    const mode = id.slice("host-budget-".length);
    let source = "";
    let stdin: ByteSource | undefined;
    let limits: ShellLimits = {};
    let expected: keyof ShellLimits = "maxCommands";
    if (mode === "c-source-utf8") {
      source = `bash -c 'printf é'; bash -c 'printf é'`;
      limits = { maxSourceBytes: Buffer.byteLength(source) + Buffer.byteLength("printf é") * 2 - 1 };
      expected = "maxSourceBytes";
    } else if (mode === "stdin-source-aggregate") {
      source = "bash -s";
      const text = "printf a\nprintf b\n";
      stdin = toByteSource(text);
      limits = { maxSourceBytes: Buffer.byteLength(source + text) - 1 };
      expected = "maxSourceBytes";
    } else if (mode === "path-repeated-source") {
      const text = "#!/bin/bash\nprintf é\n";
      await fs.writeFile("/work/tool", Buffer.from(text), { mode: 0o755 });
      source = "PATH=''; tool; tool";
      limits = { maxSourceBytes: Buffer.byteLength(source) + Buffer.byteLength(text) * 2 - 1 };
      expected = "maxSourceBytes";
    } else if (mode === "repeated-invoke-commands") {
      commands.register({ name: "repeat", async execute(context) {
        assert.ok(context.invoke);
        await context.invoke("bash", ["-c", "true; true"]);
        return context.invoke("sh", ["-c", "true; true"]);
      } });
      source = "repeat";
      limits = { maxCommands: 6 };
    } else if (mode === "mixed-output") {
      await fs.writeFile("/work/tool", Buffer.from("#!/bin/bash\nprintf é\n"), { mode: 0o755 });
      source = `bash -c 'printf é'; bash -s; PATH='' tool`;
      stdin = toByteSource("printf é\nexit\n");
      limits = { maxOutputBytes: 5 };
      expected = "maxOutputBytes";
    } else if (mode === "mixed-loops") {
      source = `bash -c 'for value in a b; do :; done'; bash -s`;
      stdin = toByteSource("for value in a b; do :; done\n");
      limits = { maxLoopIterations: 3 };
      expected = "maxLoopIterations";
    } else if (mode === "path-invoke-depth") {
      await fs.writeFile("/work/tool", Buffer.from("#!/bin/bash\nrecur\n"), { mode: 0o755 });
      commands.register({ name: "recur", async execute(context) { assert.ok(context.invoke); return context.invoke("tool", [], { env: { PATH: "" } }); } });
      source = "PATH='' tool";
      limits = { maxSubstitutionDepth: 4, maxCommands: 100 };
      expected = "maxSubstitutionDepth";
    } else throw new Error(`Unknown budget row ${mode}`);
    await assert.rejects(shell.exec(source, { limits, ...(stdin ? { stdin } : {}) }), error => error instanceof ShellLimitError && error.limit === expected);
  } else throw new Error(`Unknown host row ${id}`);
  return { id, passed: true, seen, origin };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const id = process.argv[2]!;
    console.log(JSON.stringify(id === "--batch"
      ? { sourceScope: "batch", rows: await differentialBatch(process.argv.slice(3)) }
      : id.startsWith("host-") ? await host(id) : await differential(id)));
  } catch (error) {
    console.log(JSON.stringify({ id: process.argv[2], error: String(error), stack: error instanceof Error ? error.stack : undefined }));
    process.exitCode = 1;
  }
}
