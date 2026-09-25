import { isAbsolutePath, validatePath } from "@poe-code/safe-fs/core";
import { FsError } from "./errors.js";
import type { CommandContext } from "./command.js";

export function pathOf(context: Pick<CommandContext, "cwd">, path: string): string {
  if (!path) throw new FsError("ENOENT", { path });
  validatePath(path);
  validatePath(context.cwd);
  if (!isAbsolutePath(context.cwd)) throw new FsError("EINVAL", { path: context.cwd, message: "cwd must be absolute" });
  return isAbsolutePath(path) ? path : `${context.cwd.replace(/\/$/u, "")}/${path}`;
}

export { validatePath, resolvePath, normalizePath, relativePath, isPathWithin, assertPathWithin, basename, dirname, extname, joinPath, isAbsolutePath, posixPath } from "@poe-code/safe-fs/core";
