import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { createIconvCommand, type IconvCommandsOptions } from "../../../src/commands/iconv/index.js";

export async function run(args: string[] = [], input: Uint8Array = new Uint8Array(), options: IconvCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "iconv", args, cwd: "/", env: { LC_ALL: "C" }, fs: new MemoryFileSystem(), signal: new AbortController().signal,
    stdin: toByteSource(input), stdout: { async write(value) { stdout.push(Uint8Array.from(value)); } },
    stderr: { async write(value) { stderr.push(Uint8Array.from(value)); } },
  };
  Object.defineProperties(context, Object.getOwnPropertyDescriptors(overrides));
  const result = await createIconvCommand(options).execute(context);
  return { ...result, stdoutHex: Buffer.concat(stdout).toString("hex"), stderrHex: Buffer.concat(stderr).toString("hex") };
}
