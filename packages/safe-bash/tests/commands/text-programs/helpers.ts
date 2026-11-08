import assert from "node:assert/strict";
import { dirname } from "node:path";
import { toByteSource, type ByteSource } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createTextProgramCommands, type TextProgramOptions } from "../../../src/commands/text-programs/index.js";

export interface OracleCase {
  readonly args: readonly string[];
  readonly stdin?: string | Uint8Array;
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
  readonly expectedExitCode?: number;
}

export async function makeFileSystem(files: Readonly<Record<string, string | Uint8Array>> = {}): Promise<MemoryFileSystem> {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  for (const [path, contents] of Object.entries(files)) {
    assert(path && !path.startsWith("/") && !path.split("/").includes(".."));
    await fs.mkdir(`/work/${dirname(path)}`, { recursive: true });
    await fs.writeFile(`/work/${path}`, typeof contents === "string" ? Buffer.from(contents) : contents);
  }
  return fs;
}

export async function runVirtual(tool: "sed" | "awk", fixture: OracleCase, options: TextProgramOptions = {}, source?: ByteSource) {
  const fs = await makeFileSystem(fixture.files);
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const definition = createTextProgramCommands(options).find(command => command.name === tool);
  assert(definition, `${tool} must be registered`);
  const result = await definition.execute({
    command: tool, args: fixture.args, cwd: "/work", env: { LC_ALL: "C", LANG: "C", TZ: "UTC" }, fs,
    stdin: source ?? toByteSource(fixture.stdin ?? ""), signal: new AbortController().signal,
    stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
    stderr: { async write(chunk) { stderr.push(chunk.slice()); } },
  });
  const files: Record<string, Buffer> = {};
  const visit = async (relative: string) => {
    for (const entry of await fs.readdir(`/work/${relative}`)) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.type === "directory") await visit(child);
      else files[child] = Buffer.from(await fs.readFile(`/work/${child}`));
    }
  };
  await visit("");
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), files, fs };
}

export async function* byteChunks(text: string): ByteSource {
  for (const byte of Buffer.from(text)) yield Uint8Array.of(byte);
}
