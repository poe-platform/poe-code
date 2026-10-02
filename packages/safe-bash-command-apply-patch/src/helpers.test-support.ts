import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { CommandRegistry, toByteSource, type CommandDefinition, type FileSystem } from "safe-bash-contracts";

export async function fixture(files: Record<string, string | Uint8Array> = {}) {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  for (const [path, contents] of Object.entries(files)) {
    await fs.writeFile(`/work/${path}`, typeof contents === "string" ? new TextEncoder().encode(contents) : contents);
  }
  return fs;
}

export async function run(command: string, args: readonly string[], options: {
  fs: FileSystem; commands: readonly CommandDefinition[]; stdin: string;
}) {
  const registry = new CommandRegistry();
  for (const definition of options.commands) registry.register(definition);
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await registry.get(command)!.execute({
    command, args, cwd: "/work", env: {}, fs: options.fs,
    signal: new AbortController().signal, stdin: toByteSource(options.stdin),
    stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
    stderr: { async write(chunk) { stderr.push(chunk.slice()); } },
  });
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}
