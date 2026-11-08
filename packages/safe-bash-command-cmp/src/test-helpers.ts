import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { createCmpCommand, type CmpCommandsOptions } from "./index.js";

export async function run(args: readonly string[], left: Uint8Array = Buffer.from("abc\n"), right: Uint8Array = left,
  overrides: Partial<CommandContext> = {}, options: CmpCommandsOptions = {}) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", left);
  await fs.writeFile("/right", right);
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "cmp", args, cwd: "/", env: { LC_ALL: "C" }, fs,
    stdin: toByteSource(right), signal: new AbortController().signal,
    stdout: { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    ...overrides,
  };
  const result = await createCmpCommand(options).execute(context);
  return { exitCode: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}
