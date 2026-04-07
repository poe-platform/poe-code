import path from "node:path";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import type { ActionFs } from "./types.js";

export function resolveEditor(
  env: Record<string, string | undefined> = process.env
): string {
  const editor = env.EDITOR?.trim() || env.VISUAL?.trim() || "vi";
  return editor.length > 0 ? editor : "vi";
}

export function editPlan(
  absolutePath: string,
  options: {
    env?: Record<string, string | undefined>;
    spawnSync?: typeof nodeSpawnSync;
  } = {}
): void {
  const editor = resolveEditor(options.env);
  const spawnSync = options.spawnSync ?? nodeSpawnSync;
  spawnSync(editor, [absolutePath], { stdio: "inherit" });
}

export async function archivePlan(
  entry: Pick<{ absolutePath: string }, "absolutePath">,
  fs: ActionFs
): Promise<string> {
  const archiveDir = path.join(path.dirname(entry.absolutePath), "archive");
  const archivedPath = path.join(archiveDir, path.basename(entry.absolutePath));
  await fs.mkdir(archiveDir, { recursive: true });
  await fs.rename(entry.absolutePath, archivedPath);
  return archivedPath;
}

export async function deletePlan(
  entry: Pick<{ absolutePath: string }, "absolutePath">,
  fs: Pick<ActionFs, "unlink">
): Promise<void> {
  await fs.unlink(entry.absolutePath);
}
