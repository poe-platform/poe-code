import nodeFs from "node:fs/promises";
import { isAbsolute } from "node:path";
import { UserError } from "toolcraft";

import { hasOwnErrorCode } from "../error-codes.js";
import { listEvals } from "./registry.js";
import type { EvalFs } from "../types.js";

export interface EvalSource {
  rootDir: string;
}

export async function openSource(dir: string): Promise<EvalSource>;
export async function openSource(dir: string, fs: EvalFs): Promise<EvalSource>;
export async function openSource(
  dir: string,
  fs: EvalFs = nodeFs as unknown as EvalFs
): Promise<EvalSource> {
  if (!isAbsolute(dir)) {
    throw new UserError(`Eval source path must be absolute, received "${dir}".`);
  }

  let stat: Awaited<ReturnType<EvalFs["stat"]>>;
  try {
    stat = await fs.stat(dir);
  } catch (error) {
    if (isMissingPath(error)) {
      throw new UserError(`Eval source "${dir}" does not exist or is not a directory.`);
    }
    throw error;
  }

  if (!stat.isDirectory()) {
    throw new UserError(`Eval source "${dir}" is not a directory.`);
  }

  const source = { rootDir: dir };
  const evalIds = await listEvals(source, fs);

  if (evalIds.length === 0) {
    throw new UserError(emptySourceMessage(dir));
  }

  return source;
}

export function emptySourceMessage(dir: string): string {
  return [
    `Eval source "${dir}" does not contain any first-level <id>/eval.yaml files.`,
    "Create one with: poe-code eval init my-eval --target-repo <git-url>"
  ].join("\n");
}

function isMissingPath(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR");
}
