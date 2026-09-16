import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import type { CommandContext, FileSystem } from "../../../src/contracts/index.js";
import { createInstallCommand, type InstallCommandsOptions } from "../../../src/commands/install/index.js";

export async function run(args: readonly string[], fs: FileSystem = createMemoryFileSystem(), options: InstallCommandsOptions = {}, overrides: Partial<CommandContext> = {}, defaultProfile = true) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = { command: "install", args, fs, cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: (async function* () { yield await Promise.reject(new Error("install must not consume stdin")); })(),
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } }, ...overrides };
  const result = await createInstallCommand({ ...(defaultProfile ? { identity: { uid: 0, gid: 0 }, securityContext: { enabled: false } } : {}), ...options }).execute(context);
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

export function wrapped(fs: FileSystem, overrides: { [Key in keyof FileSystem]?: FileSystem[Key] | undefined }): FileSystem {
  return new Proxy(fs, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

export async function seed() {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/source", Uint8Array.of(255, 0, 128, 65, 10), { mode: 0o640 });
  await fs.utimes!("/source", 1000, 2000);
  return fs;
}
