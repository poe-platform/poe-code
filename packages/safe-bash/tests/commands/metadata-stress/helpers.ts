import assert from "node:assert/strict";
import { toByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { createMetadataCommands, type MetadataCommandsOptions } from "../../../src/commands/metadata/index.js";

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
