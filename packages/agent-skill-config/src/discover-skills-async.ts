import path from "node:path";
import { hasOwnErrorCode } from "./error-codes.js";
import type { SkillRuntimeOptions } from "./resolve-skill-reference.js";

export interface DiscoveredSkill {
  name: string;
  file: string;
  content: string;
}

/** Load direct child SKILL.md files exclusively through the supplied capability. */
export async function discoverSkillsAsync(
  directories: readonly string[],
  options: SkillRuntimeOptions & { nativePaths?: boolean }
): Promise<DiscoveredSkill[]> {
  const { createNodeFsBridge } = await import("@poe-code/safe-fs");
  const paths = options.nativePaths ? path : path.posix;
  const fs = options.nativePaths ? options.fs : createNodeFsBridge(options.fs, {
    cwd: options.cwd, root: "/", signal: options.signal
  });
  const skills: DiscoveredSkill[] = [];
  const seen = new Set<string>();
  for (const directory of directories) {
    options.signal?.throwIfAborted();
    const root = paths.resolve(options.cwd, directory);
    let names: string[];
    try {
      const stat = await fs.lstat(root);
      const symbolic = "isSymbolicLink" in stat ? stat.isSymbolicLink() : stat.type === "symlink";
      if (symbolic) throw new Error(`Skill directory must not be a symbolic link: ${root}`);
      const entries = await fs.readdir(root);
      names = entries.map(entry => typeof entry === "string" ? entry : entry.name);
    } catch (error) {
      if (hasOwnErrorCode(error, "ENOENT")) continue;
      throw error;
    }
    for (const name of names.sort()) {
      options.signal?.throwIfAborted();
      const folder = paths.join(root, name);
      const stat = await fs.lstat(folder);
      const isDirectory = "isDirectory" in stat ? stat.isDirectory() : stat.type === "directory";
      if (!isDirectory) continue;
      const file = paths.join(folder, "SKILL.md");
      if (seen.has(file)) continue;
      try {
        const fileStat = await fs.lstat(file);
        const isFile = "isFile" in fileStat ? fileStat.isFile() : fileStat.type === "file";
        if (!isFile) throw new Error(`Skill file must be a regular file: ${file}`);
        const raw = await fs.readFile(file);
        options.signal?.throwIfAborted();
        const content = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
        skills.push({ name, file, content });
        seen.add(file);
      } catch (error) {
        if (hasOwnErrorCode(error, "ENOENT")) continue;
        throw error;
      }
    }
  }
  return skills;
}
