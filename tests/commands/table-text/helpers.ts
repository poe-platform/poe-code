import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { type ByteSource, type CommandContext, type FileSystem, toByteSource } from "../../../src/contracts/index.js";
import { createTableTextCommands, type TableTextCommandsOptions } from "../../../src/commands/table-text/index.js";
import type { TableCase } from "./cases.js";

export async function runTable(fixture: TableCase, options: TableTextCommandsOptions = {}, overrides: Partial<CommandContext> = {}, chunkBytes = 7) {
  const fs: FileSystem = overrides.fs ?? createMemoryFileSystem();
  await fs.mkdir("/work", { recursive: true });
  for (const [name, hex] of Object.entries(fixture.files)) await fs.writeFile(`/work/${name}`, Buffer.from(hex, "hex"));
  const stdin = Buffer.from(fixture.stdinHex, "hex");
  const source: ByteSource = (async function* () {
    for (let offset = 0; offset < stdin.length; offset += chunkBytes) yield stdin.subarray(offset, offset + chunkBytes);
  })();
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: fixture.command, args: fixture.args, fs, cwd: "/work", env: { LC_ALL: "C" },
    stdin: source, signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } }, ...overrides,
  };
  const result = await createTableTextCommands(options).find(command => command.name === fixture.command)!.execute(context);
  return { ...result, stdoutHex: Buffer.concat(stdout).toString("hex"), stderr: Buffer.concat(stderr).toString(), fs };
}

export function fixture(command: TableCase["command"], args: readonly string[], files: Record<string, string> = {}, stdin = ""): TableCase {
  return { name: "contract", command, args, files: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, Buffer.from(text).toString("hex")])), stdinHex: Buffer.from(stdin).toString("hex") };
}

export { toByteSource };
