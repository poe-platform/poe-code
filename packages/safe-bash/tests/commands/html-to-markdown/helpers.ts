import { createHtmlToMarkdownCommand, type HtmlToMarkdownCommandsOptions } from "../../../src/commands/html-to-markdown/index.js";
import { toByteSource, type ByteSource, type CommandContext, type FileSystem, type InvocationCleanup } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";

export async function convert(input: string | Uint8Array | ByteSource, options: HtmlToMarkdownCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [], cleanup: InvocationCleanup[] = [];
  const context: CommandContext = {
    command: "html-to-markdown", args: [], stdin: typeof input === "string" || input instanceof Uint8Array ? toByteSource(input) : input,
    stdout: { write: async bytes => { stdout.push(new Uint8Array(bytes)); } },
    stderr: { write: async bytes => { stderr.push(new Uint8Array(bytes)); } },
    cwd: "/", env: Object.create(null) as Record<string, string>, fs: new MemoryFileSystem(),
    signal: new AbortController().signal, registerCleanup: callback => { cleanup.push(callback); }, ...overrides,
  };
  try {
    const result = await createHtmlToMarkdownCommand(options).execute(context);
    return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), bytes: Buffer.concat(stdout), context, cleanup };
  } finally { for (const callback of cleanup) await callback(); }
}

export function byteChunks(text: string, size = 1): ByteSource {
  const bytes = Buffer.from(text);
  return { async *[Symbol.asyncIterator]() { for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size); } };
}

export function readonlyFacade(fs: FileSystem, overrides: Partial<FileSystem>, omitted: readonly (keyof FileSystem)[] = []): FileSystem {
  return new Proxy(fs, { get(target, key) {
    if (omitted.includes(key as keyof FileSystem)) return undefined;
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
