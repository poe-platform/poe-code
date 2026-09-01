import assert from "node:assert/strict";
import { dirname, join, resolve, sep } from "node:path";
import { toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createSearchCommands, type SearchOptions } from "../../../src/commands/search/index.js";

export interface Fixture {
  readonly args: readonly string[];
  readonly stdin?: string | Uint8Array;
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
  readonly directories?: readonly string[];
  readonly links?: Readonly<Record<string, string>>;
  readonly code?: number;
}

function safePath(root: string, relative: string): string {
  assert(relative && !relative.startsWith("/") && !relative.includes("\0"));
  const path = resolve(root, relative);
  assert(path.startsWith(root + sep), `fixture path outside isolated root: ${relative}`);
  return path;
}

export async function makeFileSystem(fixture: Fixture): Promise<MemoryFileSystem> {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  for (const directory of fixture.directories ?? []) await fs.mkdir(safePath("/work", directory), { recursive: true });
  for (const [name, bytes] of Object.entries(fixture.files ?? {})) {
    const path = safePath("/work", name);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, Buffer.from(bytes));
  }
  for (const [name, target] of Object.entries(fixture.links ?? {})) {
    const path = safePath("/work", name);
    safePath("/work", join(dirname(name), target));
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.symlink(target, path);
  }
  return fs;
}

export async function virtual(fixture: Fixture, options: SearchOptions = {}, overrides: Partial<CommandContext> = {}) {
  const fs = await makeFileSystem(fixture);
  const output: Buffer[] = []; const errors: Buffer[] = [];
  const context: CommandContext = {
    command: "rg", args: fixture.args, cwd: "/work", env: { LC_ALL: "C", LANG: "C" }, fs,
    stdin: toByteSource(fixture.stdin ?? ""), stdinIsDefault: fixture.stdin === undefined, signal: new AbortController().signal,
    stdout: { async write(bytes) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes) { errors.push(Buffer.from(bytes)); } }, ...overrides,
  };
  const result = await createSearchCommands(options)[0]!.execute(context);
  for (const [name, bytes] of Object.entries(fixture.files ?? {})) assert.deepEqual(Buffer.from(await fs.readFile(`/work/${name}`)), Buffer.from(bytes), `search changed ${name}`);
  return { code: result.exitCode, stdout: Buffer.concat(output), stderr: Buffer.concat(errors), fs };
}

export function jsonEvents(bytes: Uint8Array): unknown[] {
  return Buffer.from(bytes).toString("utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line, (key, value: unknown) => key === "elapsed" || key === "elapsed_total" ? "nondeterministic native timing" : value));
}
