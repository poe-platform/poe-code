export type WorkspaceMode = "read" | "edit" | "auto" | "yolo";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ResolverFileSystem {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  stat(path: string): Promise<{ isDirectory(): boolean }>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
  rm?(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

export type LocatorScheme = "local" | "github" | "ssh" | "docker";

export type ParsedLocator =
  | { scheme: "local"; path: string }
  | { scheme: "github"; owner: string; repo: string; ref?: string; subdir?: string }
  | { scheme: "ssh"; user?: string; host: string; port?: number; path: string }
  | { scheme: "docker"; container: string; path: string };

export interface ResolvedWorkspace {
  cwd: string;
  cleanup?: () => Promise<void>;
  locator: ParsedLocator;
}

export interface WorkspaceResolverOptions {
  baseDir: string;
  homeDir: string;
  mode?: WorkspaceMode;
  exec: (command: string, args: string[], options?: { cwd?: string }) => Promise<ExecResult>;
  fs: ResolverFileSystem;
}
