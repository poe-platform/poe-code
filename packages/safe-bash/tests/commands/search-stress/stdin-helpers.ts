import { createSearchCommands, type SearchOptions } from "../../../src/commands/search/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import type { CommandContext } from "../../../src/contracts/index.js";

export const discovered = "match.txt:needle\n";

export async function inputFileSystem(): Promise<MemoryFileSystem> {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/match.txt", Buffer.from("needle\n"));
  await fs.writeFile("/work/empty", new Uint8Array());
  await fs.writeFile("/work/.patterns", Buffer.from("needle\n"));
  return fs;
}

export async function searchInput(fs: MemoryFileSystem, input: Pick<CommandContext, "stdin" | "stdinIsDefault">, args: readonly string[] = ["needle"], options: SearchOptions = {}) {
  const output: Buffer[] = []; const errors: Buffer[] = [];
  const context: CommandContext = {
    command: "rg", args, cwd: "/work", env: {}, fs, signal: new AbortController().signal, ...input,
    stdout: { async write(chunk) { output.push(Buffer.from(chunk)); } },
    stderr: { async write(chunk) { errors.push(Buffer.from(chunk)); } },
  };
  const result = await createSearchCommands(options)[0]!.execute(context);
  return { code: result.exitCode, stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString() };
}
