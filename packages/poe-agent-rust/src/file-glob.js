import fsPromises from "node:fs/promises";
import path from "node:path";
import { native } from "./native.js";
import { hasOwnErrorCode } from "./error-codes.js";

// Static prefixes limit traversal to the requested directory. Matching uses the
// original pattern prefix so '../' and absolute patterns keep their meaning.
export async function globFiles({ pattern, cwd, fs = fsPromises }) {
  const glob = new native.NativeAgentGlob(pattern);
  const staticPath = glob.staticPath();
  if (staticPath !== null) {
    const target = path.resolve(cwd, staticPath);
    try {
      return (await fs.stat(target)).isFile() && glob.matches(staticPath) ? [target] : [];
    } catch (error) {
      if (hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR")) return [];
      throw error;
    }
  }
  const base = glob.base();
  const maxDepth = glob.maxDepth();
  let unescapedBase = "";
  for (let index = 0; index < base.length; index++) {
    if (base[index] === "\\" && index + 1 < base.length) index++;
    unescapedBase += base[index];
  }
  const root = path.resolve(cwd, unescapedBase || ".");
  const files = [];
  const pending = [{ directory: root, ancestry: new Set(), depth: 0 }];
  while (pending.length > 0) {
    const { directory, ancestry, depth } = pending.pop();
    let canonical;
    try {
      canonical = await fs.realpath(directory);
    } catch (error) {
      if (hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR")) continue;
      throw error;
    }
    // A cycle along one ancestry cannot produce a finite glob traversal. Keeping
    // ancestry per directory permits separate noncyclic aliases of the same path.
    if (ancestry.has(canonical)) continue;
    const ancestors = new Set(ancestry);
    ancestors.add(canonical);
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR")) continue;
      throw error;
    }
    const targets = [],
      candidates = [];
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const stat = entry.isSymbolicLink()
        ? await fs.stat(target).catch((error) => {
            if (hasOwnErrorCode(error, "ENOENT")) return undefined;
            throw error;
          })
        : entry;
      if (stat?.isDirectory()) {
        if (maxDepth === null || depth < maxDepth)
          pending.push({ directory: target, ancestry: ancestors, depth: depth + 1 });
      } else if (stat?.isFile()) {
        const candidate = unescapedBase + path.relative(root, target).split(path.sep).join("/");
        candidates.push(candidate);
        targets.push(target);
      }
    }
    const matched = glob.matchPaths(candidates);
    for (let index = 0; index < matched.length; index++)
      if (matched[index]) files.push(targets[index]);
  }
  return [...new Set(files)];
}
