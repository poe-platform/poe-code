import { MemoryFileSystem, Shell, diffPatchCommands, type FileSystem } from "../../../../src/index.js";
import { decoys, type Vector } from "./vectors.js";

export const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export async function setup(vector?: Vector): Promise<MemoryFileSystem> {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.mkdir("/authorized");
  for (const [path, content] of Object.entries(decoys)) await fs.writeFile(`/work/${path}`, Buffer.from(content));
  if (vector && vector.initial !== null) await fs.writeFile(target(vector), Buffer.from(vector.initial));
  return fs;
}

export const target = (vector: Vector): string => vector.args.includes("/authorized/target") ? "/authorized/target" : "/work/target";

export async function snapshot(fs: MemoryFileSystem): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  async function visit(path: string): Promise<void> {
    const stat = await fs.lstat(path);
    result[path] = { type: stat.type, mode: stat.mode, nlink: stat.nlink,
      ...(stat.type === "file" ? { bytes: Buffer.from(await fs.readFile(path)).toString("base64") }
        : stat.type === "symlink" ? { link: await fs.readlink(path) } : {}) };
    if (stat.type === "directory") for (const entry of await fs.readdir(path)) await visit(`${path === "/" ? "" : path}/${entry.name}`);
  }
  await visit("/");
  return result;
}

export async function contents(fs: MemoryFileSystem, path: string): Promise<string | null> {
  try { return Buffer.from(await fs.readFile(path)).toString("utf8"); }
  catch (error) { if ((error as { code?: string }).code === "ENOENT") return null; throw error; }
}

export function execute(fs: FileSystem, args: readonly string[], input: string, signal?: AbortSignal) {
  return new Shell({ fs, cwd: "/work", limits: { maxOutputBytes: 65_536 } }).use(diffPatchCommands())
    .exec(["patch", ...args].map(quote).join(" "), { stdin: input, ...(signal ? { signal } : {}) });
}

export interface Mutation { method: "writeFile" | "rm" | "rmdir"; path: string; signal: AbortSignal | undefined }

export function observe(fs: MemoryFileSystem, fault?: { method: Mutation["method"]; path: string; after: boolean }) {
  const calls: string[] = [];
  const mutations: Mutation[] = [];
  const proxy = new Proxy(fs, {
    get(backing, property) {
      const value: unknown = Reflect.get(backing, property, backing);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push(String(property));
        const mutation = property === "writeFile" || property === "rm" || property === "rmdir";
        const path = String(args[0]);
        const options = args[property === "writeFile" ? 2 : 1] as { signal?: AbortSignal } | undefined;
        if (mutation) mutations.push({ method: property, path, signal: options?.signal });
        const fail = fault?.method === property && fault.path === path;
        if (!fail) return Reflect.apply(value, backing, args) as unknown;
        return (async () => {
          if (!fault.after) throw new Error("injected-before-effect");
          await Reflect.apply(value, backing, args);
          throw new Error("injected-after-effect");
        })();
      };
    },
  });
  return { fs: proxy, calls, mutations };
}
