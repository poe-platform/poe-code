import { createStandardCommands } from "../../../src/commands/index.js";
import { createByteCommands } from "../../../src/commands/bytes/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { type ByteSource, type CommandContext, type FileSystem } from "../../../src/contracts/index.js";
import { type Vector } from "./vectors.js";

const commands = [...createStandardCommands(), ...createByteCommands()];
export async function fixture(vector: Vector) {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  for (const directory of vector.directories ?? []) await fs.mkdir(`/work/${directory}`, { recursive: true });
  for (const [name, value] of Object.entries(vector.files ?? {})) {
    const path = `/work/${name}`;
    await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await fs.writeFile(path, Buffer.from(value, "base64"));
  }
  for (const [name, target] of Object.entries(vector.links ?? {})) await fs.symlink(target, `/work/${name}`);
  return fs;
}
export async function* chunks(bytes: Uint8Array, width = 1): ByteSource {
  for (let offset = 0; offset < bytes.length; offset += width) yield bytes.subarray(offset, offset + width);
}
export async function execute(name: string, args: string[], overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = { command: name, args, cwd: "/work", fs: await fixture({ name, command: "wc", args: [] }), env: { LC_ALL: "C" },
    stdin: chunks(new Uint8Array()), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } }, ...overrides };
  const result = await commands.find(command => command.name === name)!.execute(context);
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), context };
}
export async function snapshot(fs: FileSystem, directory = "/work"): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function walk(path: string) {
    for (const entry of await fs.readdir(path)) {
      const child = `${path}/${entry.name}`, stat = await fs.lstat(child);
      if (stat.type === "directory") await walk(child);
      else files[child.slice(directory.length + 1)] = stat.type === "symlink" ? `link:${await fs.readlink!(child)}` : Buffer.from(await fs.readFile(child)).toString("base64");
    }
  }
  await walk(directory);
  return files;
}
