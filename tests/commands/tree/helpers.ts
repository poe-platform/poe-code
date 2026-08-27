import { createTreeCommand, treeCommands, type TreeCommandsOptions } from "../../../src/commands/tree/index.js";
import { type CommandContext, type FileSystem } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

export const fixtureDirectories = ["dir", "dir/sub", "empty", ".hidden-dir"];
export const fixtureFiles = ["a.txt", "B", "é", "雪", "line\nfeed", "tab\tname", "back\\slash", "dir/z.txt", "dir/sub/c.md", ".hide"];
export const fixtureLinks = [["link", "dir"], ["broken", "absent"], ["dir/up", ".."]] as const;

export async function seed(fs: FileSystem, links = true): Promise<void> {
  for (const directory of fixtureDirectories) await fs.mkdir(`/${directory}`);
  for (const file of fixtureFiles) await fs.writeFile(`/${file}`, new Uint8Array());
  if (links) for (const [name, target] of fixtureLinks) await fs.symlink!(target, `/${name}`);
}

export async function run(args: readonly string[], options: TreeCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = { command: "tree", args, cwd: "/", env: {}, fs: createMemoryFileSystem(),
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } }, ...overrides };
  const result = await createTreeCommand(options).execute(context);
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

export function quote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }

export async function shellRun(fs: FileSystem, args: readonly string[], options: TreeCommandsOptions = {}) {
  const shell = new Shell({ fs }).use(treeCommands(options));
  try { return await shell.exec(`tree ${args.map(quote).join(" ")}`); }
  finally { await shell.dispose(); }
}

export function wrapped(fs: FileSystem, overrides: Partial<{ [Key in keyof FileSystem]: FileSystem[Key] | undefined }>): FileSystem {
  return new Proxy(fs, { get(target, property) {
    const value = Object.hasOwn(overrides, property) ? Reflect.get(overrides, property) : Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
