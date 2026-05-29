import { createHash } from "node:crypto";
import { promises as nodeFs } from "node:fs";
import path from "node:path";
import type { RunnerScope } from "@poe-code/poe-code-config";
import type { DownloadResult, UploadResult } from "./execution-env.js";

export type { DownloadResult, UploadResult } from "./execution-env.js";

export interface WorkspaceTransferDirent {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface WorkspaceTransferStats {
  isFile(): boolean;
  isDirectory(): boolean;
  size: number;
}

export interface WorkspaceTransferFileSystem {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string, options: { withFileTypes: true }): Promise<WorkspaceTransferDirent[]>;
  readFile(path: string): Promise<Buffer>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, data: string | Buffer): Promise<void>;
  stat(path: string): Promise<WorkspaceTransferStats>;
  rm?(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  unlink?(path: string): Promise<void>;
  rmdir?(path: string): Promise<void>;
}

export interface WorkspaceTransferEnv {
  cwd: string;
  uploadDir: string;
  workspaceDir?: string;
  fs?: WorkspaceTransferFileSystem;
  remoteFs?: WorkspaceTransferFileSystem;
}

export interface WorkspaceTransferOptions {
  runner?: RunnerScope;
  uploadMaxFileMb?: number;
  workspaceExclude?: string[];
  warn?: (message: string) => void;
}

export interface WorkspaceDownloadOptions {
  conflictPolicy: "refuse" | "overwrite";
}

interface UploadedFileState {
  hash: string;
  uploaded: boolean;
}

interface FileEntry {
  path: string;
  absolutePath: string;
  bytes: number;
  content: Buffer;
}

interface IgnoreRule {
  pattern: string;
  negate: boolean;
  directoryOnly: boolean;
  anchored: boolean;
}

const uploadState = new WeakMap<object, Map<string, UploadedFileState>>();

export async function uploadWorkspace(
  env: WorkspaceTransferEnv,
  opts: WorkspaceTransferOptions
): Promise<UploadResult> {
  const localFs = env.fs ?? (nodeFs as unknown as WorkspaceTransferFileSystem);
  const remoteFs = env.remoteFs ?? localFs;
  const workspaceDir = env.workspaceDir ?? "/workspace";
  const maxBytes = (opts.uploadMaxFileMb ?? opts.runner?.upload_max_file_mb ?? 100) * 1024 * 1024;
  const warn = opts.warn ?? console.warn;
  const allFiles = await listFiles(localFs, env.cwd);
  const state = new Map<string, UploadedFileState>();
  const gitignore = await readIgnoreFile(localFs, env.cwd, ".gitignore", true);
  const poeCodeIgnore = await readIgnoreFile(localFs, env.cwd, ".poe-code-ignore", false);
  const workspaceExclude = parseIgnoreLines(
    [...(opts.runner?.workspace?.exclude ?? []), ...(opts.workspaceExclude ?? [])],
    false
  );
  const entries: FileEntry[] = [];
  const skipped: UploadResult["skipped"] = [];

  for (const file of allFiles) {
    if (
      isIgnoredByGit(file.path, gitignore) ||
      isIgnoredAdditively(file.path, poeCodeIgnore) ||
      isIgnoredAdditively(file.path, workspaceExclude)
    ) {
      continue;
    }

    const content = await localFs.readFile(file.absolutePath);
    const bytes = content.byteLength;
    state.set(file.path, {
      hash: hashBuffer(content),
      uploaded: false
    });

    if (bytes > maxBytes) {
      skipped.push({ path: file.path, bytes, reason: "max_size" });
      warn(`Skipping ${file.path}: ${bytes} bytes exceeds upload_max_file_mb.`);
      continue;
    }

    entries.push({ ...file, bytes, content });
    state.set(file.path, {
      hash: hashBuffer(content),
      uploaded: true
    });
  }

  await removeTree(remoteFs, workspaceDir);
  await remoteFs.mkdir(workspaceDir, { recursive: true });
  await remoteFs.mkdir(env.uploadDir, { recursive: true });
  await remoteFs.writeFile(path.join(env.uploadDir, "workspace.tar"), createTar(entries));

  for (const entry of entries) {
    const remotePath = path.join(workspaceDir, entry.path);
    await remoteFs.mkdir(path.dirname(remotePath), { recursive: true });
    await remoteFs.writeFile(remotePath, entry.content);
  }

  uploadState.set(env, state);

  return {
    files: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    skipped
  };
}

export async function downloadWorkspace(
  env: WorkspaceTransferEnv,
  opts: WorkspaceDownloadOptions
): Promise<DownloadResult> {
  const localFs = env.fs ?? (nodeFs as unknown as WorkspaceTransferFileSystem);
  const remoteFs = env.remoteFs ?? localFs;
  const workspaceDir = env.workspaceDir ?? "/workspace";
  const state = uploadState.get(env) ?? new Map<string, UploadedFileState>();
  const remoteFiles = await listFilesIfExists(remoteFs, workspaceDir);
  const remotePaths = new Set(remoteFiles.map((file) => file.path));
  const conflicts: DownloadResult["conflicts"] = [];
  let files = 0;
  let bytes = 0;

  for (const remoteFile of remoteFiles) {
    const remoteContent = await remoteFs.readFile(remoteFile.absolutePath);
    const localPath = path.join(env.cwd, remoteFile.path);
    const conflict = await isDownloadConflict(
      localFs,
      localPath,
      remoteFile.path,
      remoteContent,
      state
    );

    if (conflict && opts.conflictPolicy === "refuse") {
      conflicts.push({ path: remoteFile.path, reason: "local_modified" });
      continue;
    }

    await localFs.mkdir(path.dirname(localPath), { recursive: true });
    await localFs.writeFile(localPath, remoteContent);
    state.set(remoteFile.path, {
      hash: hashBuffer(remoteContent),
      uploaded: true
    });
    files += 1;
    bytes += remoteContent.length;
  }

  for (const [relativePath, fileState] of state) {
    if (!fileState.uploaded || remotePaths.has(relativePath)) {
      continue;
    }

    const localPath = path.join(env.cwd, relativePath);
    const localContent = await readFileIfExists(localFs, localPath);
    if (localContent === null) {
      continue;
    }

    if (opts.conflictPolicy === "refuse" && hashBuffer(localContent) !== fileState.hash) {
      conflicts.push({ path: relativePath, reason: "local_modified" });
      continue;
    }

    await removeFile(localFs, localPath);
  }

  return { files, bytes, conflicts };
}

async function listFilesIfExists(
  fs: WorkspaceTransferFileSystem,
  root: string
): Promise<Omit<FileEntry, "content">[]> {
  try {
    return await listFiles(fs, root);
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

async function listFiles(
  fs: WorkspaceTransferFileSystem,
  root: string
): Promise<Omit<FileEntry, "content">[]> {
  const result: Omit<FileEntry, "content">[] = [];

  async function visit(dir: string): Promise<void> {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    for (const dirent of dirents.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!dirent.isFile()) {
        continue;
      }

      const stats = await fs.stat(absolutePath);
      result.push({
        path: toRelativePath(root, absolutePath),
        absolutePath,
        bytes: stats.size
      });
    }
  }

  await visit(root);
  return result;
}

async function readIgnoreFile(
  fs: WorkspaceTransferFileSystem,
  cwd: string,
  fileName: string,
  allowNegation: boolean
): Promise<IgnoreRule[]> {
  const content = await readFileIfExists(fs, path.join(cwd, fileName));
  if (content === null) {
    return [];
  }
  return parseIgnoreLines(content.toString("utf8").split("\n"), allowNegation);
}

function parseIgnoreLines(lines: string[], allowNegation: boolean): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const negate = allowNegation && line.startsWith("!");
    const patternWithMarker = negate ? line.slice(1) : line;
    if (patternWithMarker.length === 0) {
      continue;
    }

    const anchored = patternWithMarker.startsWith("/");
    const directoryOnly = patternWithMarker.endsWith("/");
    const pattern = stripSlashes(
      directoryOnly ? patternWithMarker.slice(0, -1) : patternWithMarker
    );
    if (pattern.length > 0) {
      rules.push({ pattern, negate, directoryOnly, anchored });
    }
  }
  return rules;
}

function isIgnoredByGit(relativePath: string, rules: IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (matchesRule(relativePath, rule)) {
      ignored = !rule.negate;
    }
  }
  return ignored;
}

function isIgnoredAdditively(relativePath: string, rules: IgnoreRule[]): boolean {
  return rules.some((rule) => matchesRule(relativePath, rule));
}

function matchesRule(relativePath: string, rule: IgnoreRule): boolean {
  const normalizedPath = normalizeRelativePath(relativePath);
  const normalizedPattern = normalizeRelativePath(rule.pattern);
  if (rule.directoryOnly) {
    return pathMatchesDirectory(normalizedPath, normalizedPattern, rule.anchored);
  }

  if (rule.anchored || normalizedPattern.includes("/")) {
    return matchPathSegments(normalizedPath.split("/"), normalizedPattern.split("/"));
  }

  return normalizedPath.split("/").some((segment) => matchSegment(segment, normalizedPattern));
}

function pathMatchesDirectory(relativePath: string, pattern: string, anchored: boolean): boolean {
  if (anchored || pattern.includes("/")) {
    return relativePath === pattern || relativePath.startsWith(`${pattern}/`);
  }

  const segments = relativePath.split("/");
  return segments.some((segment, index) => {
    return matchSegment(segment, pattern) && index < segments.length - 1;
  });
}

function matchPathSegments(pathSegments: string[], patternSegments: string[]): boolean {
  if (pathSegments.length !== patternSegments.length) {
    return false;
  }

  return patternSegments.every((patternSegment, index) =>
    matchSegment(pathSegments[index] ?? "", patternSegment)
  );
}

function matchSegment(value: string, pattern: string): boolean {
  const patternParts = pattern.split("*");
  if (patternParts.length === 1) {
    return value === pattern;
  }

  let offset = 0;
  for (const [index, part] of patternParts.entries()) {
    if (part.length === 0) {
      continue;
    }

    const foundAt = value.indexOf(part, offset);
    if (foundAt === -1) {
      return false;
    }

    if (index === 0 && foundAt !== 0) {
      return false;
    }

    offset = foundAt + part.length;
  }

  const lastPart = patternParts.at(-1) ?? "";
  return lastPart.length === 0 || value.endsWith(lastPart);
}

async function isDownloadConflict(
  fs: WorkspaceTransferFileSystem,
  localPath: string,
  relativePath: string,
  remoteContent: Buffer,
  state: Map<string, UploadedFileState>
): Promise<boolean> {
  const localContent = await readFileIfExists(fs, localPath);
  if (localContent === null) {
    return false;
  }

  const localHash = hashBuffer(localContent);
  const remoteHash = hashBuffer(remoteContent);
  const uploadedHash = state.get(relativePath)?.hash;
  const localChanged = uploadedHash === undefined || localHash !== uploadedHash;
  return localChanged && localHash !== remoteHash;
}

async function readFileIfExists(
  fs: WorkspaceTransferFileSystem,
  filePath: string
): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function removeTree(fs: WorkspaceTransferFileSystem, targetPath: string): Promise<void> {
  if (fs.rm) {
    await fs.rm(targetPath, { recursive: true, force: true });
    return;
  }

  const stats = await statIfExists(fs, targetPath);
  if (stats === null) {
    return;
  }
  if (stats.isFile()) {
    await removeFile(fs, targetPath);
    return;
  }

  const dirents = await fs.readdir(targetPath, { withFileTypes: true });
  for (const dirent of dirents) {
    await removeTree(fs, path.join(targetPath, dirent.name));
  }
  if (fs.rmdir) {
    await fs.rmdir(targetPath);
  }
}

async function removeFile(fs: WorkspaceTransferFileSystem, filePath: string): Promise<void> {
  if (fs.rm) {
    await fs.rm(filePath, { force: true });
    return;
  }
  if (fs.unlink) {
    await fs.unlink(filePath);
  }
}

async function statIfExists(
  fs: WorkspaceTransferFileSystem,
  targetPath: string
): Promise<WorkspaceTransferStats | null> {
  try {
    return await fs.stat(targetPath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

function createTar(entries: FileEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    chunks.push(createTarHeader(entry.path, entry.bytes));
    chunks.push(entry.content);
    chunks.push(Buffer.alloc(paddingFor(entry.bytes)));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function createTarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  writeString(header, name, 0, 100);
  writeOctal(header, 0o644, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(32, 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar", 257, 5, "ascii");
  header.write("00", 263, 2, "ascii");
  writeOctal(header, checksum(header), 148, 8);
  return header;
}

function writeString(buffer: Buffer, value: string, offset: number, length: number): void {
  const text = Buffer.from(value);
  text.copy(buffer, offset, 0, Math.min(text.length, length));
}

function writeOctal(buffer: Buffer, value: number, offset: number, length: number): void {
  const text = value.toString(8).padStart(length - 1, "0");
  buffer.write(text.slice(0, length - 1), offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

function checksum(buffer: Buffer): number {
  return buffer.reduce((sum, value) => sum + value, 0);
}

function paddingFor(size: number): number {
  const remainder = size % 512;
  return remainder === 0 ? 0 : 512 - remainder;
}

function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function toRelativePath(root: string, absolutePath: string): string {
  return normalizeRelativePath(path.relative(root, absolutePath));
}

function normalizeRelativePath(value: string): string {
  return stripSlashes(value.split(path.sep).join("/"));
}

function stripSlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (value[start] === "/") {
    start += 1;
  }
  while (value[end - 1] === "/") {
    end -= 1;
  }
  return value.slice(start, end);
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
