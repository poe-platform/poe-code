import path from "node:path";
import { resolveFileIncludes } from "../run/runner.js";
import { defineRecordEntry } from "../utils.js";

function looksLikeDocPath(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes("\n")) return false;
  // Treat templated content as literal content, not a path.
  if (trimmed.includes("{{")) return false;
  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return true;
  }
  if (trimmed.includes("/")) return true;
  if (trimmed.endsWith(".md") || trimmed.endsWith(".markdown") || trimmed.endsWith(".txt")) {
    return true;
  }
  return false;
}

async function resolveDocVarFromPath(options: {
  key: string;
  value: string;
  cwd: string;
  readFile: (filePath: string, encoding: BufferEncoding) => Promise<string>;
}): Promise<string> {
  const trimmed = options.value.trim();
  const absolutePath = path.resolve(options.cwd, trimmed);
  const relativePath = path.relative(options.cwd, absolutePath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      `Pipeline doc var "${options.key}" resolves outside the project root: ${trimmed}`
    );
  }
  try {
    return await options.readFile(absolutePath, "utf8");
  } catch (error) {
    throw new Error(
      `Failed to read doc var "${options.key}" from "${trimmed}" (resolved to ${absolutePath}).`,
      { cause: error }
    );
  }
}

export async function resolvePipelineVars(
  vars: Record<string, string>,
  cwd: string,
  readFile: (filePath: string, encoding: BufferEncoding) => Promise<string>,
  options: { deferFileIncludes?: boolean } = {}
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (key.endsWith("_doc") && looksLikeDocPath(value)) {
      const docContent = await resolveDocVarFromPath({ key, value, cwd, readFile });
      defineRecordEntry(resolved, key, options.deferFileIncludes ? docContent : await resolveFileIncludes(docContent, cwd, readFile));
      continue;
    }
    defineRecordEntry(resolved, key, options.deferFileIncludes ? value : await resolveFileIncludes(value, cwd, readFile));
  }
  return resolved;
}
