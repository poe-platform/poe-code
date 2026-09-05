import { createMikeYqCommand, type MikeYqOptions } from "../../../src/commands/yq/mike.js";
import { toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";

export { native, nativeOptions, authenticateOracle } from "../yq-scripting/helpers.js";

export async function run(args: readonly string[], input = "", overrides: Partial<CommandContext> = {}, options: MikeYqOptions = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createMikeYqCommand(options).execute({
    command: "yq", args, cwd: "/", env: {}, fs: createMemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource(input),
    stdout: { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    ...overrides,
  });
  return { status: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}
