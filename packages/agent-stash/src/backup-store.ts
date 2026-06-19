import path from "node:path";
import { backupRoot } from "./locations.js";
import { assertNoSymlinkAncestors, assertNotSymlink, isDirectory, pathExists, readFileIfExists, removePath, writeTextFile } from "./fs-utils.js";
import type {
  AgentStashContext,
  BackupRecord,
  CreateBackupOptions,
  RestoreBackupOptions,
  RestoreResult
} from "./types.js";

const BACKUP_METADATA = "backup.json";
const MAX_BACKUPS = 20;

interface BackupEntry {
  directoryName: string;
  record: BackupRecord;
}

export async function createBackup(ctx: AgentStashContext, options: CreateBackupOptions): Promise<BackupRecord> {
  validateBackupPaths(ctx, options.paths);
  const timestamp = (ctx.now?.() ?? new Date()).toISOString();
  await assertBackupStoragePath(ctx, path.join(backupRoot(ctx.homeDir), "__probe__"));
  const id = await allocateBackupId(ctx, timestamp);
  const root = path.join(backupRoot(ctx.homeDir), id);
  const temporaryRoot = `${root}.tmp-${id}`;
  const files: BackupRecord["files"] = [];
  const directories: string[] = [];

  try {
    for (const sourcePath of [...options.paths].sort()) {
      await assertBackupDataPath(ctx, sourcePath);
      if (!(await pathExists(ctx.fs, sourcePath))) {
        const backupPath = path.join(root, "files", path.relative("/", sourcePath));
        files.push({ sourcePath, backupPath, existed: false });
        continue;
      }
      await assertNotSymlink(ctx.fs, sourcePath);
      const stat = await ctx.fs.stat(sourcePath);
      if (isDirectory(stat)) {
        await backupDirectory(ctx, root, temporaryRoot, sourcePath, files, directories);
      } else {
        await backupFile(ctx, root, temporaryRoot, sourcePath, files);
      }
    }

    const record: BackupRecord = {
      id,
      createdAt: timestamp,
      command: options.command,
      args: options.args,
      cwd: ctx.cwd,
      homeDir: ctx.homeDir,
      targetScope: parseTargetScope(options.args.scope),
      targetAgent: typeof options.args.agent === "string" ? options.args.agent : undefined,
      affectedPaths: [...options.paths].sort(),
      directories: [...directories].sort(),
      files
    };
    await writeTextFile(ctx.fs, path.join(temporaryRoot, BACKUP_METADATA), `${JSON.stringify(record, null, 2)}\n`);
    if (!ctx.fs.rename) {
      throw new Error("Backup creation requires filesystem rename support.");
    }
    await ctx.fs.rename(temporaryRoot, root);
    await pruneOldBackups(ctx);
    return record;
  } catch (error) {
    try {
      await removePath(ctx.fs, temporaryRoot);
    } catch {
      // Preserve the backup failure that explains why the operation could not complete.
    }
    throw error;
  }
}

function validateBackupPaths(ctx: AgentStashContext, paths: readonly string[]): void {
  const cwd = path.resolve(ctx.cwd);
  const homeDir = path.resolve(ctx.homeDir);
  for (const backupPath of paths) {
    const resolved = path.resolve(backupPath);
    if (!isPathWithin(resolved, cwd) && !isPathWithin(resolved, homeDir)) {
      throw new Error(`Backup path is outside backup roots: ${backupPath}`);
    }
  }
}

async function allocateBackupId(ctx: AgentStashContext, timestamp: string): Promise<string> {
  const baseId = `backup-${timestamp.replaceAll(":", "-").replaceAll(".", "-")}`;
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const id = attempt === 0 ? baseId : `${baseId}-${attempt}`;
    const root = path.join(backupRoot(ctx.homeDir), id);
    const temporaryRoot = `${root}.tmp-${id}`;
    if (!(await pathExists(ctx.fs, root)) && !(await pathExists(ctx.fs, temporaryRoot))) {
      return id;
    }
  }
  throw new Error(`Unable to allocate backup id for ${timestamp}`);
}

function parseTargetScope(value: unknown): BackupRecord["targetScope"] {
  return value === "project" || value === "global" ? value : undefined;
}

async function backupDirectory(
  ctx: AgentStashContext,
  finalRoot: string,
  writeRoot: string,
  sourcePath: string,
  files: BackupRecord["files"],
  directories: string[]
): Promise<void> {
  directories.push(sourcePath);
  const entries = await ctx.fs.readdir(sourcePath);
  for (const entry of entries) {
    const child = path.join(sourcePath, entry);
    await assertNotSymlink(ctx.fs, child);
    const stat = await ctx.fs.stat(child);
    if (isDirectory(stat)) {
      await backupDirectory(ctx, finalRoot, writeRoot, child, files, directories);
    } else {
      await backupFile(ctx, finalRoot, writeRoot, child, files);
    }
  }
}

async function backupFile(
  ctx: AgentStashContext,
  finalRoot: string,
  writeRoot: string,
  sourcePath: string,
  files: BackupRecord["files"]
): Promise<void> {
  const relative = path.relative("/", sourcePath);
  const backupPath = path.join(finalRoot, "files", relative);
  const writePath = path.join(writeRoot, "files", relative);
  const content = await readFileIfExists(ctx.fs, sourcePath);
  files.push({ sourcePath, backupPath, existed: content !== null });
  if (content !== null) {
    await writeTextFile(ctx.fs, writePath, content);
  }
}

export async function listBackups(ctx: AgentStashContext): Promise<BackupRecord[]> {
  const entries = await readBackupEntries(ctx, { removeInvalidEntries: false });
  return entries.map((entry) => entry.record);
}

async function readBackupEntries(
  ctx: AgentStashContext,
  options: { removeInvalidEntries: boolean }
): Promise<BackupEntry[]> {
  const root = backupRoot(ctx.homeDir);
  await assertBackupStoragePath(ctx, path.join(root, "__probe__"));
  if (!(await pathExists(ctx.fs, root))) {
    return [];
  }
  const directoryNames = await ctx.fs.readdir(root);
  const backups: BackupEntry[] = [];
  for (const directoryName of directoryNames) {
    const entryPath = path.join(root, directoryName);
    await assertBackupEntryPath(ctx, entryPath);
    const entryStat = await ctx.fs.stat(entryPath);
    if (!isDirectory(entryStat)) {
      continue;
    }
    const metadata = await readFileIfExists(ctx.fs, path.join(entryPath, BACKUP_METADATA));
    if (metadata !== null) {
      try {
        const record = parseBackupRecord(metadata, directoryName);
        validateBackupRecordShape(record, directoryName);
        validateBackupEntry(directoryName, record);
        backups.push({ directoryName, record });
      } catch (error) {
        if (!options.removeInvalidEntries) {
          throw error;
        }
        await removePath(ctx.fs, entryPath);
        continue;
      }
    }
  }
  return backups.sort(
    (left, right) =>
      right.record.createdAt.localeCompare(left.record.createdAt) || right.record.id.localeCompare(left.record.id)
  );
}

function validateBackupEntry(directoryName: string, record: BackupRecord): void {
  assertValidBackupId(directoryName);
  if (record.id !== directoryName) {
    throw new Error(`Backup metadata id mismatch for ${directoryName}`);
  }
}

function validateBackupRecordShape(record: unknown, backupId: string): asserts record is BackupRecord {
  if (!isRecord(record)) {
    throw new Error(`Backup metadata must be an object for ${backupId}`);
  }
  if (typeof record.id !== "string") {
    throw new Error(`Backup metadata id must be a string for ${backupId}`);
  }
  if (typeof record.createdAt !== "string") {
    throw new Error(`Backup metadata createdAt must be a string for ${backupId}`);
  }
  if (typeof record.command !== "string") {
    throw new Error(`Backup metadata command must be a string for ${backupId}`);
  }
  if (!isRecord(record.args)) {
    throw new Error(`Backup metadata args must be an object for ${backupId}`);
  }
  if (typeof record.cwd !== "string") {
    throw new Error(`Backup metadata cwd must be a string for ${backupId}`);
  }
  if (typeof record.homeDir !== "string") {
    throw new Error(`Backup metadata homeDir must be a string for ${backupId}`);
  }
  if (record.targetScope !== undefined && record.targetScope !== "project" && record.targetScope !== "global") {
    throw new Error(`Backup metadata targetScope is invalid for ${backupId}`);
  }
  if (record.targetAgent !== undefined && typeof record.targetAgent !== "string") {
    throw new Error(`Backup metadata targetAgent must be a string for ${backupId}`);
  }
  if (!Array.isArray(record.affectedPaths)) {
    throw new Error(`Backup metadata affectedPaths must be an array for ${backupId}`);
  }
  for (const affectedPath of record.affectedPaths) {
    if (typeof affectedPath !== "string") {
      throw new Error(`Backup metadata affectedPaths must contain only strings for ${backupId}`);
    }
  }
  if (record.directories !== undefined) {
    if (!Array.isArray(record.directories)) {
      throw new Error(`Backup metadata directories must be an array for ${backupId}`);
    }
    for (const directory of record.directories) {
      if (typeof directory !== "string") {
        throw new Error(`Backup metadata directories must contain only strings for ${backupId}`);
      }
    }
  }
  if (!Array.isArray(record.files)) {
    throw new Error(`Backup metadata files must be an array for ${backupId}`);
  }
  for (const file of record.files) {
    if (!isRecord(file)) {
      throw new Error(`Backup metadata files must contain only objects for ${backupId}`);
    }
    if (typeof file.sourcePath !== "string") {
      throw new Error(`Backup metadata file sourcePath must be a string for ${backupId}`);
    }
    if (typeof file.backupPath !== "string") {
      throw new Error(`Backup metadata file backupPath must be a string for ${backupId}`);
    }
    if (typeof file.existed !== "boolean") {
      throw new Error(`Backup metadata file existed must be a boolean for ${backupId}`);
    }
  }
}

export async function restoreBackup(ctx: AgentStashContext, options: RestoreBackupOptions): Promise<RestoreResult> {
  if (!options.yes) {
    throw new Error("Restoring a backup requires --yes.");
  }
  assertValidBackupId(options.backupId);
  const backupEntryRoot = path.join(backupRoot(ctx.homeDir), options.backupId);
  await assertBackupEntryPath(ctx, backupEntryRoot);
  if (!(await pathExists(ctx.fs, backupEntryRoot))) {
    throw new Error(`Backup not found: ${options.backupId}`);
  }
  const entryStat = await ctx.fs.stat(backupEntryRoot);
  if (!isDirectory(entryStat)) {
    throw new Error(`Backup not found: ${options.backupId}`);
  }
  await assertBackupStoragePath(ctx, path.join(backupEntryRoot, BACKUP_METADATA));
  const metadata = await readFileIfExists(ctx.fs, path.join(backupEntryRoot, BACKUP_METADATA));
  if (metadata === null) {
    throw new Error(`Backup not found: ${options.backupId}`);
  }
  const record = parseBackupRecord(metadata, options.backupId);
  validateBackupRecordShape(record, options.backupId);
  validateBackupEntry(options.backupId, record);
  if (path.resolve(ctx.cwd) !== path.resolve(record.cwd) || path.resolve(ctx.homeDir) !== path.resolve(record.homeDir)) {
    throw new Error("Backup restore requires matching --cwd and --home for the original backup roots.");
  }
  const restoreRoot = path.join(backupRoot(ctx.homeDir), options.backupId);
  validateBackupRecordForRestore(record, restoreRoot);
  await assertBackupRecordPathsSafe(ctx, record);
  const files = await readBackupFiles(ctx, record, restoreRoot);
  await validateRestoreRemovalTargets(ctx, record.affectedPaths);
  const restored: string[] = [];
  for (const affectedPath of record.affectedPaths) {
    await removeExistingPath(ctx, affectedPath);
  }
  for (const directory of restoreDirectories(record)) {
    await ctx.fs.mkdir(directory, { recursive: true });
    if (!record.files.some((file) => isPathWithin(path.resolve(file.sourcePath), path.resolve(directory)))) {
      restored.push(directory);
    }
  }
  for (const file of files) {
    if (!file.existed) {
      await removeExistingPath(ctx, file.sourcePath);
      restored.push(file.sourcePath);
      continue;
    }
    await writeTextFile(ctx.fs, file.sourcePath, file.content);
    restored.push(file.sourcePath);
  }
  return { restored };
}

function parseBackupRecord(content: string, backupId: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error(`Malformed backup metadata for ${backupId}.`);
  }
}

function restoreDirectories(record: BackupRecord): string[] {
  return [...(record.directories ?? [])]
    .sort((left, right) => left.length - right.length || left.localeCompare(right));
}

async function validateRestoreRemovalTargets(ctx: AgentStashContext, affectedPaths: readonly string[]): Promise<void> {
  if (ctx.fs.rm) {
    return;
  }
  for (const affectedPath of affectedPaths) {
    if (!(await pathExists(ctx.fs, affectedPath))) {
      continue;
    }
    const stat = await ctx.fs.stat(affectedPath);
    if (isDirectory(stat)) {
      throw new Error(`Filesystem rm support is required to restore directory: ${affectedPath}`);
    }
  }
}

async function readBackupFiles(
  ctx: AgentStashContext,
  record: BackupRecord,
  root: string
): Promise<Array<{ sourcePath: string; existed: false } | { sourcePath: string; existed: true; content: string }>> {
  const files: Array<{ sourcePath: string; existed: false } | { sourcePath: string; existed: true; content: string }> = [];
  for (const file of record.files) {
    if (file.existed) {
      await assertBackupPayloadPath(ctx, file.backupPath, root);
    }
    files.push(file.existed
      ? { sourcePath: file.sourcePath, existed: true, content: await ctx.fs.readFile(file.backupPath, "utf8") }
      : { sourcePath: file.sourcePath, existed: false });
  }
  return files;
}

function validateBackupRecordForRestore(record: BackupRecord, root: string): void {
  const cwd = path.resolve(record.cwd);
  const homeDir = path.resolve(record.homeDir);
  const affectedPaths = record.affectedPaths.map((affectedPath) => {
    const resolved = path.resolve(affectedPath);
    if (!isPathWithin(resolved, cwd) && !isPathWithin(resolved, homeDir)) {
      throw new Error(`Backup metadata affected path is outside backup roots: ${affectedPath}`);
    }
    return resolved;
  });
  const restoredFilePaths = record.files
    .filter((file) => file.existed)
    .map((file) => path.resolve(file.sourcePath));
  const backupFilesRoot = path.join(root, "files");
  for (const directory of record.directories ?? []) {
    const directoryPath = path.resolve(directory);
    if (!affectedPaths.some((affectedPath) => isPathWithin(directoryPath, affectedPath))) {
      throw new Error(`Backup metadata directory path is outside affected paths: ${directory}`);
    }
    if (restoredFilePaths.some((filePath) => isPathWithin(directoryPath, filePath))) {
      throw new Error(`Backup metadata directory path collides with restored file: ${directory}`);
    }
  }
  for (const file of record.files) {
    const sourcePath = path.resolve(file.sourcePath);
    if (!affectedPaths.some((affectedPath) => isPathWithin(sourcePath, affectedPath))) {
      throw new Error(`Backup metadata source path is outside affected paths: ${file.sourcePath}`);
    }
    if (file.existed) {
      const backupPath = path.resolve(file.backupPath);
      const backupRootPath = path.resolve(backupFilesRoot);
      if (!isPathWithin(backupPath, backupRootPath)) {
        throw new Error(`Backup metadata file path is outside backup root: ${file.backupPath}`);
      }
      const expectedBackupPath = path.resolve(path.join(backupFilesRoot, path.relative("/", sourcePath)));
      if (backupPath !== expectedBackupPath) {
        throw new Error(`Backup metadata file path mismatch for ${file.sourcePath}`);
      }
    }
  }
}

function isPathWithin(targetPath: string, rootPath: string): boolean {
  return targetPath === rootPath || targetPath.startsWith(`${rootPath}${path.sep}`);
}

async function removeExistingPath(ctx: AgentStashContext, targetPath: string): Promise<void> {
  if (!(await pathExists(ctx.fs, targetPath))) {
    return;
  }
  await assertNotSymlink(ctx.fs, targetPath);
  if (ctx.fs.rm) {
    await ctx.fs.rm(targetPath, { force: true, recursive: true });
    return;
  }
  await ctx.fs.unlink(targetPath);
}

export async function removeBackup(ctx: AgentStashContext, backupId: string): Promise<void> {
  assertValidBackupId(backupId);
  const target = path.join(backupRoot(ctx.homeDir), backupId);
  await assertBackupEntryPath(ctx, target);
  if (!(await pathExists(ctx.fs, target))) {
    throw new Error(`Backup not found: ${backupId}`);
  }
  const stat = await ctx.fs.stat(target);
  if (!isDirectory(stat)) {
    throw new Error(`Backup not found: ${backupId}`);
  }
  await removePath(ctx.fs, target);
}

async function assertBackupStoragePath(ctx: AgentStashContext, targetPath: string): Promise<void> {
  await assertNoSymlinkAncestors(ctx.fs, targetPath, ctx.homeDir);
}

async function assertBackupEntryPath(ctx: AgentStashContext, targetPath: string): Promise<void> {
  await assertBackupStoragePath(ctx, targetPath);
  await assertNotSymlink(ctx.fs, targetPath);
}

async function assertBackupPayloadPath(ctx: AgentStashContext, targetPath: string, root: string): Promise<void> {
  await assertNoSymlinkAncestors(ctx.fs, targetPath, root);
  await assertNotSymlink(ctx.fs, targetPath);
}

async function assertBackupRecordPathsSafe(ctx: AgentStashContext, record: BackupRecord): Promise<void> {
  for (const affectedPath of record.affectedPaths) {
    await assertBackupDataPath(ctx, affectedPath);
  }
  for (const directory of record.directories ?? []) {
    await assertBackupDataPath(ctx, directory);
  }
  for (const file of record.files) {
    await assertBackupDataPath(ctx, file.sourcePath);
  }
}

async function assertBackupDataPath(ctx: AgentStashContext, targetPath: string): Promise<void> {
  const root = backupDataRootForPath(ctx, targetPath);
  if (root === undefined) {
    return;
  }
  await assertNoSymlinkAncestors(ctx.fs, targetPath, root);
  await assertNotSymlink(ctx.fs, targetPath);
}

function backupDataRootForPath(ctx: AgentStashContext, targetPath: string): string | undefined {
  const resolved = path.resolve(targetPath);
  const cwd = path.resolve(ctx.cwd);
  if (isPathWithin(resolved, cwd)) {
    return cwd;
  }
  const homeDir = path.resolve(ctx.homeDir);
  if (isPathWithin(resolved, homeDir)) {
    return homeDir;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertValidBackupId(backupId: string): void {
  if (backupId.length === 0 || backupId.includes("/") || backupId.includes("\\") || backupId === "." || backupId === "..") {
    throw new Error(`Invalid backup id: ${backupId}`);
  }
}

async function pruneOldBackups(ctx: AgentStashContext): Promise<void> {
  const backups = await readBackupEntries(ctx, { removeInvalidEntries: true });
  for (const backup of backups.slice(MAX_BACKUPS)) {
    await removePath(ctx.fs, path.join(backupRoot(ctx.homeDir), backup.directoryName));
  }
}
