import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createSafeJsCommands, MemoryFileSystem, toByteSource } from "virtual-bash";

assert.ok(process.env.SAFEJS_LOCAL_ROOT, "This public-boundary gate requires the actual copied engine");
const load = name => import(pathToFileURL(join(process.env.SAFEJS_LOCAL_ROOT, "src", name)).href);
export const { run } = await load("run.ts");
export const { Budget } = await load("interp/budget.ts");
export const { makeFsModule } = await load("modules/fs.ts");
export const { declareHostOperation } = await load("interp/host-bridge.ts");
export const runtime = { run, createBudget: options => new Budget(options), makeFsModule, declareHostOperation };
export const quote = source => `'${source.replaceAll("'", "'\\''")}'`;

export async function memory() {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  return fs;
}

export async function command(source, { fs, signal, env, stdin, stdout, stderr, runtime: supplied, limits } = {}) {
  const output = [];
  const errors = [];
  const context = {
    command: "safejs", args: ["-p", "-e", source], fs: fs ?? await memory(), cwd: "/work",
    env: env ?? {}, stdin: stdin ?? toByteSource(""), signal: signal ?? new AbortController().signal,
    stdout: stdout ?? { async write(bytes) { output.push(bytes.slice()); } },
    stderr: stderr ?? { async write(bytes) { errors.push(bytes.slice()); } },
  };
  const [definition] = createSafeJsCommands({ runtime: supplied ?? runtime, ...(limits ? { limits } : {}) });
  const result = await definition.execute(context);
  return { ...result, stdout: Buffer.concat(output), stderr: Buffer.concat(errors).toString(), context };
}

export async function rejected(promise) {
  try { await promise; } catch (error) { return error; }
  assert.fail("Expected rejection");
}
