import crypto from "node:crypto";
import path from "node:path";
import type { AgentStashFile, AgentStashFileSystem, BundleFile } from "./types.js";
import { isDirectory, isFile, pathExists } from "./fs-utils.js";

export function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function hashFiles(files: readonly AgentStashFile[]): string {
  const input = files
    .map((file) => `${file.path}\0${file.size}\0${file.sha256}`)
    .sort()
    .join("\0");
  return sha256(input);
}

export async function readDirectoryBundle(
  fs: AgentStashFileSystem,
  sourceDir: string,
  bundleRoot: string,
  shouldIncludePath?: (sourcePath: string) => boolean | Promise<boolean>
): Promise<{ bundleFiles: BundleFile[]; manifestFiles: AgentStashFile[]; latestModifiedAt?: Date }> {
  if (!(await pathExists(fs, sourceDir))) {
    return { bundleFiles: [], manifestFiles: [] };
  }

  const bundleFiles: BundleFile[] = [];
  const manifestFiles: AgentStashFile[] = [];
  let latestModifiedAt: Date | undefined;

  async function walk(current: string): Promise<void> {
    if (current !== sourceDir && shouldIncludePath && !(await shouldIncludePath(current))) {
      return;
    }
    const lstat = await fs.lstat(current);
    if (lstat.isSymbolicLink()) {
      throw new Error(`Refusing to bundle symbolic link: ${current}`);
    }

    const stat = await fs.stat(current);
    if (isDirectory(stat)) {
      const entries = await fs.readdir(current);
      for (const entry of [...entries].sort()) {
        await walk(path.join(current, entry));
      }
      return;
    }

    if (!isFile(stat)) {
      throw new Error(`Refusing to bundle unsupported filesystem entry: ${current}`);
    }
    const modifiedAt = statModifiedAt(stat);
    if (modifiedAt !== undefined && (latestModifiedAt === undefined || modifiedAt.getTime() > latestModifiedAt.getTime())) {
      latestModifiedAt = modifiedAt;
    }

    const content = await fs.readFile(current, "utf8");
    const relative = path.relative(sourceDir, current).split(path.sep).join("/");
    const bundlePath = `${bundleRoot}/${relative}`;
    const fileHash = sha256(content);
    bundleFiles.push({ path: bundlePath, content });
    manifestFiles.push({ path: bundlePath, size: Buffer.byteLength(content, "utf8"), sha256: fileHash });
  }

  await walk(sourceDir);
  return { bundleFiles, manifestFiles, latestModifiedAt };
}

function statModifiedAt(stat: { mtime?: Date; mtimeMs?: number }): Date | undefined {
  if (stat.mtime instanceof Date && !Number.isNaN(stat.mtime.getTime())) {
    return stat.mtime;
  }
  if (typeof stat.mtimeMs === "number" && Number.isFinite(stat.mtimeMs)) {
    return new Date(stat.mtimeMs);
  }
  return undefined;
}
