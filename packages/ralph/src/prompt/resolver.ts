import { resolve as resolvePath, join } from "node:path";

type ResolverFileSystem = {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
};

export type ResolveTemplateOptions = {
  fs: ResolverFileSystem;
  cwd: string;
  homeDir?: string;
  bundledDir: string;
};

export async function resolveTemplate(
  name: string,
  options: ResolveTemplateOptions
): Promise<string | null> {
  const paths = [
    resolvePath(options.cwd, ".agents/poe-code-ralph", name)
  ];

  if (options.homeDir) {
    paths.push(join(options.homeDir, ".poe-code", "ralph", name));
  }

  paths.push(join(options.bundledDir, name));

  for (const p of paths) {
    try {
      return await options.fs.readFile(p, "utf8");
    } catch {
      continue;
    }
  }

  return null;
}
