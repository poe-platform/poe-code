import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as host from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { toByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { createMetadataCommands, type MetadataCommandsOptions } from "../../../src/commands/metadata/index.js";

export const suiteRoot = fileURLToPath(new URL("./", import.meta.url));
export const oracleRoot = join(suiteRoot, ".oracle/coreutils-9.7");

export async function namespace(context: TestContext): Promise<string> {
  const root = await host.mkdtemp(join(suiteRoot, ".native-"));
  context.after(() => host.rm(root, { recursive: true, force: true }));
  return root;
}

export function oracle(command: "chmod" | "stat" | "mktemp", args: readonly string[], cwd: string, umask = 0o022, env: Record<string, string> = {}) {
  assert.ok(cwd.startsWith(join(suiteRoot, ".native-")));
  const result = spawnSync("/bin/bash", ["-c", 'umask "$1"; shift; exec "$@"', "metadata-oracle", umask.toString(8), join(oracleRoot, "src", command), ...args], {
    cwd, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC", TMPDIR: cwd, ...env }, timeout: 3000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr.toString() };
}

export async function run(command: string, args: readonly string[], fs: FileSystem, configuration: MetadataCommandsOptions = {}, extra: { signal?: AbortSignal; env?: Record<string, string>; write?: (chunk: Uint8Array) => Promise<void> } = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const definition = createMetadataCommands(configuration).find(entry => entry.name === command);
  assert.ok(definition);
  const result = await definition.execute({ command, args, fs, cwd: "/work", env: extra.env ?? {}, signal: extra.signal ?? new AbortController().signal,
    stdin: toByteSource(""), stdout: { async write(chunk) { await extra.write?.(chunk); stdout.push(chunk.slice()); } }, stderr: { async write(chunk) { stderr.push(chunk.slice()); } },
  });
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
}

export async function snapshot(fs: FileSystem, path = "/work"): Promise<unknown[]> {
  const stat = await fs.lstat(path);
  const entry = { path, type: stat.type, mode: stat.mode & 0o7777,
    ...(stat.type === "file" ? { bytes: Buffer.from(await fs.readFile(path)).toString("hex") } : {}),
    ...(stat.type === "symlink" ? { target: await fs.readlink?.(path) } : {}),
  };
  const entries: unknown[] = [entry];
  if (stat.type === "directory") for (const child of (await fs.readdir(path)).sort((left, right) => left.name.localeCompare(right.name))) entries.push(...await snapshot(fs, `${path}/${child.name}`));
  return entries;
}

export async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await host.readFile(path)).digest("hex");
}
