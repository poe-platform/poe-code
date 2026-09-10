import { lstat, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export async function discoverTest262(corpus: string, selections: readonly string[] = ["."]): Promise<string[]> {
  if (selections.length === 0) throw new Error("Test262 selection must not be empty");
  const root = resolve(corpus, "test");
  const files = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Test262 discovery rejects symbolic link: ${path}`);
    if (info.isDirectory()) {
      for (const name of await readdir(path)) await visit(join(path, name));
    } else if (info.isFile() && path.endsWith(".js")) {
      files.add(relative(root, path).split(sep).join("/"));
    }
  };
  for (const selection of selections) {
    const target = resolve(root, selection);
    const parts = relative(root, target).split(sep);
    if (isAbsolute(selection) || parts[0] === "..") throw new Error("Test262 selection escapes the test tree");
    let parent = root;
    for (const part of ["", ...parts.slice(0, -1)]) {
      parent = join(parent, part);
      if ((await lstat(parent)).isSymbolicLink()) throw new Error(`Test262 discovery rejects symbolic link: ${parent}`);
    }
    await visit(target);
  }
  if (files.size === 0) throw new Error("Test262 selection contains no JavaScript sources");
  return [...files].sort();
}
