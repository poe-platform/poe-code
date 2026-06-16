import { createHash, randomUUID } from "node:crypto";
import { promises as nodeFs } from "node:fs";
import path from "node:path";
import type { DownloadResult, UploadResult } from "./types.js";

export type { DownloadResult, UploadResult } from "./types.js";

export interface WorkspaceTransferDirent {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink?(): boolean;
}

export interface WorkspaceTransferStats {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink?(): boolean;
  size: number;
}

export interface WorkspaceTransferFileSystem {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string, options: { withFileTypes: true }): Promise<WorkspaceTransferDirent[]>;
  readFile(path: string): Promise<Buffer>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(
    path: string,
    data: string | Buffer,
    options?: { flag?: string; mode?: number }
  ): Promise<void>;
  stat(path: string): Promise<WorkspaceTransferStats>;
  lstat?(path: string): Promise<WorkspaceTransferStats>;
  rename?(oldPath: string, newPath: string): Promise<void>;
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
  runner?: WorkspaceTransferRunnerOptions;
  uploadMaxFileMb?: number;
  workspaceExclude?: string[];
  warn?: (message: string) => void;
}

export interface WorkspaceTransferRunnerOptions {
  upload_max_file_mb?: number;
  workspace?: { exclude?: string[] };
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
  basePath: string;
}

const uploadState = new WeakMap<object, Map<string, UploadedFileState>>();

export async function uploadWorkspace(
  env: WorkspaceTransferEnv,
  opts: WorkspaceTransferOptions
): Promise<UploadResult> {
  const localFs = env.fs ?? (nodeFs as unknown as WorkspaceTransferFileSystem);
  const remoteFs = env.remoteFs ?? localFs;
  const workspaceDir = env.workspaceDir ?? "/workspace";
  const maxBytes = resolveUploadMaxBytes(opts);
  const warn = opts.warn ?? console.warn;
  const allFiles = await listFiles(localFs, env.cwd);
  const state = new Map<string, UploadedFileState>();
  const gitignore = await readGitignoreRules(localFs, env.cwd, allFiles);
  const poeCodeIgnore = await readIgnoreFile(localFs, env.cwd, ".poe-code-ignore", false);
  const workspaceExclude = parseIgnoreLines(
    [".git/", ...(opts.runner?.workspace?.exclude ?? []), ...(opts.workspaceExclude ?? [])],
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

  const stagedWorkspaceDir = `${workspaceDir}.upload-tmp`;
  const priorWorkspaceDir = `${workspaceDir}.upload-backup`;
  const archivePath = path.join(env.uploadDir, "workspace.tar");
  const stagedArchivePath = `${archivePath}.upload-tmp`;
  await removeTree(remoteFs, stagedWorkspaceDir);
  await removeTree(remoteFs, priorWorkspaceDir);
  let hadWorkspace = false;
  try {
    await remoteFs.mkdir(stagedWorkspaceDir, { recursive: true });
    await remoteFs.mkdir(env.uploadDir, { recursive: true });
    await remoteFs.writeFile(stagedArchivePath, createTar(entries));

    for (const entry of entries) {
      const remotePath = path.join(stagedWorkspaceDir, entry.path);
      await remoteFs.mkdir(path.dirname(remotePath), { recursive: true });
      await remoteFs.writeFile(remotePath, entry.content);
    }

    hadWorkspace = (await statIfExists(remoteFs, workspaceDir)) !== null;
    if (hadWorkspace) {
      await renamePath(remoteFs, workspaceDir, priorWorkspaceDir);
    }
    await renamePath(remoteFs, stagedWorkspaceDir, workspaceDir);
    await renamePath(remoteFs, stagedArchivePath, archivePath);
    await removeTree(remoteFs, priorWorkspaceDir);
  } catch (error) {
    if ((await statIfExists(remoteFs, workspaceDir)) === null && hadWorkspace) {
      await renamePath(remoteFs, priorWorkspaceDir, workspaceDir).catch(() => undefined);
    }
    await removeTree(remoteFs, stagedWorkspaceDir).catch(() => undefined);
    await removeFile(remoteFs, stagedArchivePath).catch(() => undefined);
    throw error;
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
  const remoteFiles = await listFilesIfExists(remoteFs, workspaceDir, { rejectSymlinks: true });
  const remotePaths = new Set(remoteFiles.map((file) => file.path));
  const conflicts: DownloadResult["conflicts"] = [];
  let files = 0;
  let bytes = 0;

  for (const remoteFile of remoteFiles) {
    const remoteContent = await remoteFs.readFile(remoteFile.absolutePath);
    const localPath = path.join(env.cwd, remoteFile.path);
    await assertSafeLocalDownloadPath(localFs, env.cwd, localPath);
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

    await writeFileAtomically(localFs, env.cwd, localPath, remoteContent, ".download-tmp");
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
    await assertSafeLocalDownloadPath(localFs, env.cwd, localPath);
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

function resolveUploadMaxBytes(opts: WorkspaceTransferOptions): number {
  const uploadMaxFileMb = opts.uploadMaxFileMb ?? opts.runner?.upload_max_file_mb ?? 100;
  if (!Number.isFinite(uploadMaxFileMb) || uploadMaxFileMb <= 0) {
    throw new Error("runner.upload_max_file_mb must be a finite positive number.");
  }
  return uploadMaxFileMb * 1024 * 1024;
}

async function listFilesIfExists(
  fs: WorkspaceTransferFileSystem,
  root: string,
  options: { rejectSymlinks?: boolean } = {}
): Promise<Omit<FileEntry, "content">[]> {
  try {
    return await listFiles(fs, root, options);
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

async function listFiles(
  fs: WorkspaceTransferFileSystem,
  root: string,
  options: { rejectSymlinks?: boolean } = {}
): Promise<Omit<FileEntry, "content">[]> {
  const result: Omit<FileEntry, "content">[] = [];

  async function visit(dir: string): Promise<void> {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    for (const dirent of dirents.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(dir, dirent.name);
      if (options.rejectSymlinks === true && dirent.isSymbolicLink?.() === true) {
        throw new Error("Workspace download must not follow symbolic links.");
      }
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
  return parseIgnoreLines(content.toString("utf8").split("\n"), allowNegation, "");
}

async function readGitignoreRules(
  fs: WorkspaceTransferFileSystem,
  cwd: string,
  files: Array<Omit<FileEntry, "content">>
): Promise<IgnoreRule[]> {
  const rules: IgnoreRule[] = [];
  for (const file of files) {
    if (path.basename(file.path) !== ".gitignore") {
      continue;
    }

    const content = await fs.readFile(file.absolutePath, "utf8");
    const containingDirectory = normalizeRelativePath(path.dirname(file.path));
    rules.push(
      ...parseIgnoreLines(
        content.split("\n"),
        true,
        containingDirectory === "." ? "" : containingDirectory
      )
    );
  }

  return rules;
}

function parseIgnoreLines(lines: string[], allowNegation: boolean, basePath = ""): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of lines) {
    let line = rawLine.trimEnd();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const escapedMarker = line.startsWith("\\#") || line.startsWith("\\!");
    if (escapedMarker) {
      line = line.slice(1);
    }

    const negate = !escapedMarker && allowNegation && line.startsWith("!");
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
      rules.push({ pattern, negate, directoryOnly, anchored, basePath });
    }
  }
  return rules;
}

function isIgnoredByGit(relativePath: string, rules: IgnoreRule[]): boolean {
  if (isPathIgnoredByGitRules(relativePath, rules, "path")) {
    return true;
  }

  for (const parent of parentDirectories(relativePath)) {
    if (isPathIgnoredByGitRules(parent, rules, "directory")) {
      return true;
    }
  }

  return false;
}

function isPathIgnoredByGitRules(
  relativePath: string,
  rules: IgnoreRule[],
  targetKind: "path" | "directory"
): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (matchesGitRule(relativePath, rule, targetKind)) {
      ignored = !rule.negate;
    }
  }
  return ignored;
}

function parentDirectories(relativePath: string): string[] {
  const segments = normalizeRelativePath(relativePath).split("/");
  const parents: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    parents.push(segments.slice(0, index).join("/"));
  }
  return parents;
}

function isIgnoredAdditively(relativePath: string, rules: IgnoreRule[]): boolean {
  return rules.some((rule) => matchesRule(relativePath, rule));
}

function matchesGitRule(
  relativePath: string,
  rule: IgnoreRule,
  targetKind: "path" | "directory"
): boolean {
  if (!rule.directoryOnly) {
    return matchesRule(relativePath, rule);
  }

  const normalizedPath = normalizeRelativePath(relativePath);
  const scopedPath = pathWithinRuleScope(normalizedPath, rule.basePath);
  if (scopedPath === null) {
    return false;
  }

  if (targetKind === "directory") {
    return pathMatchesDirectorySelf(scopedPath, normalizeRelativePath(rule.pattern), rule.anchored);
  }

  return !rule.negate && matchesRule(relativePath, rule);
}

function matchesRule(relativePath: string, rule: IgnoreRule): boolean {
  const normalizedPath = normalizeRelativePath(relativePath);
  const scopedPath = pathWithinRuleScope(normalizedPath, rule.basePath);
  if (scopedPath === null) {
    return false;
  }
  const normalizedPattern = normalizeRelativePath(rule.pattern);
  if (rule.directoryOnly) {
    return pathMatchesDirectory(scopedPath, normalizedPattern, rule.anchored);
  }

  if (rule.anchored || normalizedPattern.includes("/")) {
    return matchPathSegments(scopedPath.split("/"), normalizedPattern.split("/"));
  }

  return scopedPath.split("/").some((segment) => matchSegment(segment, normalizedPattern));
}

function pathWithinRuleScope(relativePath: string, basePath: string): string | null {
  if (basePath.length === 0) {
    return relativePath;
  }

  if (relativePath === basePath) {
    return "";
  }

  const prefix = `${basePath}/`;
  return relativePath.startsWith(prefix) ? relativePath.slice(prefix.length) : null;
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

function pathMatchesDirectorySelf(
  relativePath: string,
  pattern: string,
  anchored: boolean
): boolean {
  if (anchored || pattern.includes("/")) {
    return relativePath === pattern;
  }

  return relativePath.split("/").some((segment) => matchSegment(segment, pattern));
}

function matchPathSegments(pathSegments: string[], patternSegments: string[]): boolean {
  return matchPathFrom(0, 0);

  function matchPathFrom(pathIndex: number, patternIndex: number): boolean {
    if (patternIndex === patternSegments.length) {
      return pathIndex === pathSegments.length;
    }

    const patternSegment = patternSegments[patternIndex] ?? "";
    if (patternSegment === "**") {
      for (let nextPathIndex = pathIndex; nextPathIndex <= pathSegments.length; nextPathIndex += 1) {
        if (matchPathFrom(nextPathIndex, patternIndex + 1)) {
          return true;
        }
      }
      return false;
    }

    return (
      pathIndex < pathSegments.length &&
      matchSegment(pathSegments[pathIndex] ?? "", patternSegment) &&
      matchPathFrom(pathIndex + 1, patternIndex + 1)
    );
  }
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

async function renamePath(
  fs: WorkspaceTransferFileSystem,
  sourcePath: string,
  destinationPath: string
): Promise<void> {
  if (!fs.rename) {
    throw new Error("Workspace transfer filesystem must support atomic rename.");
  }

  await fs.rename(sourcePath, destinationPath);
}

async function writeFileAtomically(
  fs: WorkspaceTransferFileSystem,
  workspacePath: string,
  destinationPath: string,
  data: Buffer,
  temporarySuffix: string
): Promise<void> {
  const temporaryPath = `${destinationPath}.${randomUUID()}${temporarySuffix}`;
  let temporaryCreated = false;
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  try {
    await assertSafeLocalDownloadPath(fs, workspacePath, temporaryPath);
    try {
      await fs.writeFile(temporaryPath, data, { flag: "wx", mode: 0o600 });
      temporaryCreated = true;
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        await removeFile(fs, temporaryPath).catch(() => undefined);
      }
      throw error;
    }
    await renamePath(fs, temporaryPath, destinationPath);
  } catch (error) {
    if (temporaryCreated) {
      await removeFile(fs, temporaryPath).catch(() => undefined);
    }
    throw error;
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

async function assertSafeLocalDownloadPath(
  fs: WorkspaceTransferFileSystem,
  workspacePath: string,
  targetPath: string
): Promise<void> {
  const resolvedWorkspacePath = path.resolve(workspacePath);
  const resolvedTargetPath = path.resolve(targetPath);
  const relativePath = path.relative(resolvedWorkspacePath, resolvedTargetPath);

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("Workspace download must remain inside the local workspace.");
  }

  if (fs.lstat === undefined) {
    throw new Error("Workspace transfer filesystem must support symbolic link checks.");
  }

  let currentPath = resolvedTargetPath;

  while (true) {
    try {
      const stats = await fs.lstat(currentPath);

      if (stats.isSymbolicLink?.() === true) {
        throw new Error("Workspace download must remain inside the local workspace.");
      }
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }

    if (currentPath === resolvedWorkspacePath) {
      return;
    }

    currentPath = path.dirname(currentPath);
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
  const { entryName, prefix } = splitTarPath(name);
  writeString(header, entryName, 0, 100);
  writeOctal(header, 0o644, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(32, 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar", 257, 5, "ascii");
  header.write("00", 263, 2, "ascii");
  writeString(header, prefix, 345, 155);
  writeOctal(header, checksum(header), 148, 8);
  return header;
}

function splitTarPath(name: string): { entryName: string; prefix: string } {
  if (Buffer.byteLength(name) <= 100) {
    return { entryName: name, prefix: "" };
  }

  let separatorIndex = name.lastIndexOf("/");
  while (separatorIndex !== -1) {
    const prefix = name.slice(0, separatorIndex);
    const entryName = name.slice(separatorIndex + 1);
    if (Buffer.byteLength(entryName) <= 100 && Buffer.byteLength(prefix) <= 155) {
      return { entryName, prefix };
    }

    separatorIndex = name.lastIndexOf("/", separatorIndex - 1);
  }

  throw new Error(`Workspace tar path is too long to represent: ${name}`);
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
  return hasOwnErrorCode(error, "ENOENT");
}

function isAlreadyExistsError(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}

function hasOwnErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Object.prototype.hasOwnProperty.call(error, "code") &&
    (error as { code?: unknown }).code === code
  );
}
