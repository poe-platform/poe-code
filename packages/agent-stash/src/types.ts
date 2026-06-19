export type AgentStashScope = "project" | "global";
export type AgentStashLocationKind = "project" | "global" | "gist" | "archive";
export type AgentStashKind = "skill" | "hook";
export type ConflictPolicy = "ask" | "local" | "remote" | "newer" | "fail";
export type ConflictResolution = Exclude<ConflictPolicy, "ask">;

export interface AgentStashStat {
  mode?: number;
  isFile?: () => boolean;
  isDirectory?: () => boolean;
}

export interface AgentStashLstat extends AgentStashStat {
  isSymbolicLink(): boolean;
}

export interface AgentStashFileSystem {
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(path: string, content: string, options?: { encoding?: "utf8"; flag?: string }): Promise<void>;
  mkdir(path: string, options?: { recursive: boolean }): Promise<void>;
  rename?(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
  rm?(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  stat(path: string): Promise<AgentStashStat>;
  lstat(path: string): Promise<AgentStashLstat>;
  readdir(path: string): Promise<string[]>;
}

export interface AgentStashContext {
  cwd: string;
  homeDir: string;
  fs: AgentStashFileSystem;
  gistClient?: GistClient;
  archiveCodec?: ArchiveCodec;
  now?: () => Date;
  trace?: (record: AgentStashTraceRecord) => void | Promise<void>;
}

export interface AgentStashTraceRecord {
  event: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface AgentStashManifest {
  schemaVersion: 1;
  profile?: string;
  createdAt: string;
  updatedAt: string;
  items: AgentStashItem[];
}

export interface AgentStashItem {
  id: string;
  kind: AgentStashKind;
  agentId: string;
  name: string;
  scope: AgentStashScope;
  path: string;
  files: AgentStashFile[];
  updatedAt: string;
  contentHash: string;
}

export interface AgentStashFile {
  path: string;
  size: number;
  sha256: string;
}

export interface BundleFile {
  path: string;
  content: string;
}

export interface LoadedItem extends AgentStashItem {
  bundleFiles: BundleFile[];
  targetPath: string;
}

export interface GistFile {
  filename: string;
  content: string;
}

export interface GistWriteInput {
  description?: string;
  files: Record<string, { content: string } | null>;
}

export interface GistRecord {
  id: string;
  htmlUrl?: string;
  files: Record<string, GistFile>;
}

export interface GistClient {
  createSecret(input: GistWriteInput): Promise<GistRecord>;
  read(gistId: string): Promise<GistRecord>;
  update(gistId: string, input: GistWriteInput): Promise<GistRecord>;
}

export interface ArchiveCodec {
  write(outputPath: string, files: Record<string, string>): Promise<void>;
  read(inputPath: string): Promise<Record<string, string>>;
}

export interface AgentStashConfig {
  profiles: Record<string, AgentStashProfile>;
}

export interface AgentStashProfile {
  gistId: string;
  gistUrl?: string;
  lastPulledAt?: string;
  lastPushedAt?: string;
}

export interface UploadOptions {
  profile?: string;
  gist?: string;
  scope: AgentStashScope;
  agent: string;
  skills?: string[];
  hooks?: string[];
  yes?: boolean;
}

export interface UploadResult {
  gistId: string;
  manifest: AgentStashManifest;
  uploaded: AgentStashItem[];
}

export interface DownloadOptions {
  profile?: string;
  gist?: string;
  scope: AgentStashScope;
  agent: string;
  skills?: string[];
  hooks?: string[];
  yes?: boolean;
}

export interface DownloadResult {
  manifest: AgentStashManifest;
  downloaded: AgentStashItem[];
  backupId?: string;
}

export interface SyncOptions {
  profile?: string;
  gist?: string;
  scope: AgentStashScope;
  agent: string;
  skills?: string[];
  hooks?: string[];
  onConflict: ConflictPolicy;
  yes?: boolean;
  resolveConflict?: (conflict: SyncConflict) => Promise<ConflictResolution>;
}

export interface SyncConflict {
  item: AgentStashItem;
  local?: AgentStashItem;
  remote?: AgentStashItem;
  base?: AgentStashItem;
}

export interface SyncResult {
  uploaded: AgentStashItem[];
  downloaded: AgentStashItem[];
  deletedLocal: AgentStashItem[];
  deletedRemote: AgentStashItem[];
  unchanged: AgentStashItem[];
  conflicts: AgentStashItem[];
  backupId?: string;
}

export interface CopyMoveOptions {
  operation: "copy" | "move";
  from: AgentStashLocationKind;
  to: AgentStashLocationKind;
  profile?: string;
  agent: string;
  kind: AgentStashKind;
  name: string;
  sourceId?: string;
  yes?: boolean;
}

export interface CopyMoveResult {
  item: AgentStashItem;
  backupId?: string;
}

export interface ExportOptions {
  outputPath: string;
  profile?: string;
  gist?: string;
  scope?: AgentStashScope;
  agent?: string;
}

export interface ExportResult {
  outputPath: string;
  manifest: AgentStashManifest;
  exported: AgentStashItem[];
}

export interface ImportOptions {
  inputPath: string;
  scope: AgentStashScope;
  agent: string;
  yes?: boolean;
}

export interface ImportResult {
  manifest: AgentStashManifest;
  imported: AgentStashItem[];
  backupId?: string;
}

export interface CreateBackupOptions {
  command: string;
  args: Record<string, unknown>;
  paths: string[];
}

export interface BackupRecord {
  id: string;
  createdAt: string;
  command: string;
  args: Record<string, unknown>;
  cwd: string;
  homeDir: string;
  targetScope?: AgentStashScope;
  targetAgent?: string;
  affectedPaths: string[];
  directories?: string[];
  files: Array<{ sourcePath: string; backupPath: string; existed: boolean }>;
}

export interface RestoreBackupOptions {
  backupId: string;
  yes?: boolean;
}

export interface RestoreResult {
  restored: string[];
}
