import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { type ByteSource, type CommandContext, type FileSystem, toByteSource } from "../../../src/contracts/index.js";
import { createSplitCommands, type SplitCommandsOptions } from "../../../src/commands/split/index.js";

export async function run(args: readonly string[], input: string | Uint8Array | ByteSource = "", options: SplitCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const fs = overrides.fs ?? createMemoryFileSystem();
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "split", args, stdin: typeof input === "string" || input instanceof Uint8Array ? toByteSource(input) : input,
    stdinIsDefault: false, stdout: { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    fs, cwd: "/", env: { LC_ALL: "C" }, signal: new AbortController().signal, ...overrides,
  };
  const result = await createSplitCommands(options)[0]!.execute(context);
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), fs };
}

export async function files(fs: FileSystem, path = "/"): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  for (const entry of (await fs.readdir(path)).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.type === "file") entries[entry.name] = Buffer.from(await fs.readFile(`${path}/${entry.name}`)).toString("hex");
  }
  return entries;
}

export function chunks(input: Uint8Array, size: number, reuse = false): ByteSource {
  return (async function* () {
    const buffer = new Uint8Array(size);
    for (let offset = 0; offset < input.length; offset += size) {
      if (reuse) {
        buffer.fill(99);
        const count = Math.min(size, input.length - offset);
        buffer.set(input.subarray(offset, offset + count));
        yield buffer.subarray(0, count);
      } else yield input.subarray(offset, offset + size);
    }
    if (reuse) buffer.fill(42);
  })();
}

export function wrapped(fs: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(fs, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
