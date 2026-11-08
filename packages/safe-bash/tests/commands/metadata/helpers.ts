import { toByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { createMetadataCommands, type MetadataCommandsOptions } from "../../../src/commands/metadata/index.js";

export async function runMetadata(name: string, args: readonly string[], fs: FileSystem, options: MetadataCommandsOptions = {}, signal = new AbortController().signal, env: Record<string, string> = {}, write?: (chunk: Uint8Array) => Promise<void>) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const definition = createMetadataCommands(options).find(command => command.name === name)!;
  const result = await definition.execute({ command: name, args, fs, cwd: "/work", env, signal, stdin: toByteSource(""),
    stdout: { async write(chunk) { await write?.(chunk); stdout.push(chunk.slice()); } }, stderr: { async write(chunk) { stderr.push(chunk.slice()); } },
  });
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), stdoutBytes: Buffer.concat(stdout) };
}
