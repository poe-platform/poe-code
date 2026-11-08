import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { createHexdumpCommand, createHdCommand, type HexdumpCommandsOptions } from "../../../src/commands/hexdump/index.js";

export async function run(args: string[] = [], input: Uint8Array = new Uint8Array(), options: HexdumpCommandsOptions = {}, overrides: Partial<CommandContext> = {}, name = "hexdump") {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await (name === "hd" ? createHdCommand(options) : createHexdumpCommand(options)).execute({
    command: name, args, cwd: "/", env: { LC_ALL: "C" }, fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource(input),
    stdout: { async write(value) { stdout.push(Uint8Array.from(value)); } },
    stderr: { async write(value) { stderr.push(Uint8Array.from(value)); } }, ...overrides,
  });
  return { ...result, stdout: Buffer.concat(stdout).toString("hex"), stderr: Buffer.concat(stderr).toString("hex") };
}
