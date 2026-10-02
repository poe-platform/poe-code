import type { SkillRuntimeOptions } from "./resolve-skill-reference-async.js";
import { posixPath as path } from "@poe-code/safe-fs/runtime-core";
import { skillOperations } from "./filesystem.js";
import { hasOwnErrorCode } from "./error-codes.js";
import { assertSingleLine, appendBlock, removeBlock, nextBlockId } from "./exclude-text.js";
const defaultMarkerPrefix = "poe-code-spawn-skills";

async function findExcludePath(options: SkillRuntimeOptions): Promise<string | undefined> {
  const fs = skillOperations(options);
  let directory = options.cwd;
  while (true) {
    const gitPath = path.join(directory, ".git");
    try {
      const stat = await fs.lstat(gitPath);
      if (stat.isSymbolicLink()) throw new Error("Refusing symbolic Git directory");
      if (stat.isDirectory()) return path.join(gitPath, "info/exclude");
      const contents = await fs.readFile(gitPath, "utf8");
      if (!contents.startsWith("gitdir: ")) throw new Error("Invalid Git directory file");
      const gitDir = path.resolve(directory, contents.slice(8).trim());
      return path.join(gitDir, "info/exclude");
    } catch (error) {
      if (!hasOwnErrorCode(error, "ENOENT")) throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

async function mutateExclude(options: SkillRuntimeOptions, transform: (content: string | undefined) => { content: string; blockId?: string } | undefined): Promise<string | undefined> {
  const excludePath = await findExcludePath(options);
  if (!excludePath) return undefined;
  const fs = skillOperations(options);
  let content: string | undefined;
  try { content = await fs.readFile(excludePath, "utf8"); }
  catch (error) { if (!hasOwnErrorCode(error, "ENOENT")) throw error; }
  const result = transform(content);
  if (!result) return undefined;
  // Inspect all ancestors before mutation; never follow symlinks in Git metadata.
  let current = excludePath;
  while (true) {
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error("Refusing symbolic Git exclude path"); }
    catch (error) { if (!hasOwnErrorCode(error, "ENOENT")) throw error; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  await fs.mkdir(path.dirname(excludePath), { recursive: true });
  const temporary = `${excludePath}.${crypto.randomUUID()}.tmp`;
  let created = false;
  try {
    await fs.writeFile(temporary, result.content, { encoding: "utf8", flag: "wx" });
    created = true;
    await fs.rename(temporary, excludePath);
  } finally { if (created) await fs.rm(temporary, { force: true }); }
  return result.blockId;
}

export async function appendExcludeBlockAsync(options: SkillRuntimeOptions, runId: string, entries: string[], opts?: { markerPrefix?: string }): Promise<string | undefined> {
  const prefix = opts?.markerPrefix ?? defaultMarkerPrefix;
  assertSingleLine(runId, "runId"); assertSingleLine(prefix, "markerPrefix");
  for (const entry of entries) assertSingleLine(entry, "exclude entry");
  return mutateExclude(options, content => {
    const blockId = nextBlockId(content, runId, prefix);
    return { content: appendBlock(content, blockId, entries, prefix), blockId };
  });
}

export async function removeExcludeBlockAsync(options: SkillRuntimeOptions, runId: string, opts?: { markerPrefix?: string }): Promise<void> {
  const prefix = opts?.markerPrefix ?? defaultMarkerPrefix;
  assertSingleLine(runId, "runId"); assertSingleLine(prefix, "markerPrefix");
  await mutateExclude(options, content => content === undefined ? undefined : { content: removeBlock(content, runId, prefix) });
}
