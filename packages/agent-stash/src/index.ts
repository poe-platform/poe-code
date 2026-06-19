export type {
  AgentStashConfig,
  AgentStashContext,
  AgentStashFile,
  AgentStashFileSystem,
  AgentStashItem,
  AgentStashKind,
  AgentStashLocationKind,
  AgentStashManifest,
  AgentStashProfile,
  AgentStashScope,
  BackupRecord,
  ConflictResolution,
  SyncConflict,
  ConflictPolicy,
  CopyMoveOptions,
  CopyMoveResult,
  ExportOptions,
  ExportResult,
  DownloadOptions,
  DownloadResult,
  GistClient,
  GistRecord,
  GistWriteInput,
  ImportOptions,
  ImportResult,
  RestoreBackupOptions,
  RestoreResult,
  SyncOptions,
  SyncResult,
  UploadOptions,
  UploadResult
} from "./types.js";

export { parseManifest, serializeManifest, stableItemId, validateBundlePath } from "./manifest.js";
export { loadInventory } from "./inventory.js";
export {
  addProfile,
  loadConfig,
  parseGistRef,
  removeProfile,
  renameProfile,
  saveConfig
} from "./profile-store.js";
export { createBackup, listBackups, removeBackup, restoreBackup } from "./backup-store.js";
export { browse, buildBrowseExplorerConfig, buildBrowseModel, renderBrowse, runBrowseAction, runBrowseTui } from "./browse.js";
export type {
  BrowseActionName,
  BrowseActionOptions,
  BrowseActionResult,
  BrowseExplorerOptions,
  BrowseModel,
  BrowseOptions,
  BrowsePane
} from "./browse.js";
export { GitHubGistClient, createDefaultGistClient, resolveGitHubToken } from "./gist-client.js";
export { uploadBundle } from "./operations/upload.js";
export { downloadBundle } from "./operations/download.js";
export { syncBundle } from "./operations/sync.js";
export { copyOrMoveItem } from "./operations/copy-move.js";
export { exportArchive, importArchive } from "./operations/archive.js";
