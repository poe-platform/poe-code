import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as host from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { toByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { createMetadataCommands, type MetadataCommandsOptions } from "../../../src/commands/metadata/index.js";
import { nativeGnuBinding, verifyNativeExecutable, type NativeGnuOptions } from "../../native-profile.js";

export const suiteRoot = fileURLToPath(new URL("./", import.meta.url));
export const oracleRoot = join(suiteRoot, ".oracle/coreutils-9.7");

export function oracleIdentity(command: "chmod" | "stat" | "mktemp" | "touch" | "expr", options: NativeGnuOptions = {}) {
  const binding = nativeGnuBinding(command, options);
  if (binding) {
    verifyNativeExecutable(binding, binding.path, options);
    return binding;
  }
  assert(options.build === undefined || options.build === 1 || (options.build === 2 && command === "stat"), "only stat has an independent second build");
  const historicalHashes = {
    chmod: "3b7a9b5819dd93eff18b25dfbbac1c1d17e2ccd419368da90b366653b1b1cbd2",
    stat: "9bfc67687cc527eb69aa7a877c1551c22db6ea46ff910ad055015958924e1fea",
    mktemp: "47c9a287d363308748124c29dfd2e8f84e821a25d8279c042a54d8a4f0806d1d",
    touch: "47fc9af399d94e27bc94c19eba754502b38dfb80fbad3d09c5f6b237698dbf68",
    expr: "e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c",
  };
  const identity = {
    path: options.build === 2 ? "/private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src/stat" : join(oracleRoot, "src", command),
    sha256: options.build === 2 ? "bf6f8514f2a220a3c3743154e0530baeec864b9d1f20315cd9cb5832d28c9860" : historicalHashes[command],
    version: `${command} (GNU coreutils) 9.7`,
  };
  const fileSystem = options.fileSystem ?? fs;
  const stat = fileSystem.lstatSync(identity.path);
  assert(stat.isFile() && stat.size > 0 && stat.size <= 33554432, "bounded historical native executable required");
  assert.equal(createHash("sha256").update(fileSystem.readFileSync(identity.path)).digest("hex"), identity.sha256, "historical GNU 9.7 executable identity");
  return identity;
}

export async function namespace(context: TestContext): Promise<string> {
  const root = await host.mkdtemp(join(suiteRoot, ".native-"));
  context.after(() => host.rm(root, { recursive: true, force: true }));
  return root;
}

export function oracle(command: "chmod" | "stat" | "mktemp", args: readonly string[], cwd: string, umask = 0o022, env: Record<string, string> = {}) {
  assert.ok(cwd.startsWith(join(suiteRoot, ".native-")));
  const identity = oracleIdentity(command);
  const result = spawnSync("/bin/bash", ["-c", 'umask "$1"; shift; exec "$@"', "metadata-oracle", umask.toString(8), identity.path, ...args], {
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
