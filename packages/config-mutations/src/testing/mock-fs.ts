import path from "node:path";
import type { FileSystem } from "../types.js";

export interface MockFileSystem extends FileSystem {
  /** Current file contents, keyed by absolute path */
  files: Record<string, string>;
  /** Created directories */
  directories: Set<string>;
  /** Check if a path exists (file or directory) */
  exists(path: string): boolean;
  /** Get file content or undefined if not found */
  getContent(path: string): string | undefined;
}

export interface MockFsOptions {
  /** Initial files - paths can use ~ which will be expanded to homeDir */
  [path: string]: string;
}

const DEFAULT_HOME_DIR = "/home/test";

/**
 * Create an in-memory mock filesystem for testing mutations.
 *
 * @param initialFiles - Initial files to populate the filesystem with
 * @param homeDir - Home directory for ~ expansion (defaults to /home/test)
 */
export function createMockFs(
  initialFiles?: MockFsOptions,
  homeDir: string = DEFAULT_HOME_DIR
): MockFileSystem {
  const files: Record<string, string> = {};
  const directories = new Set<string>();

  // Initialize with provided files
  if (initialFiles) {
    for (const [filePath, content] of Object.entries(initialFiles)) {
      const absolutePath = expandPath(filePath, homeDir);
      files[absolutePath] = content;

      // Ensure parent directories exist
      const parentDir = path.dirname(absolutePath);
      addDirectoryTree(parentDir, directories);
    }
  }

  // Ensure home directory exists
  addDirectoryTree(homeDir, directories);

  const mockFs: MockFileSystem = {
    files,
    directories,

    exists(filePath: string): boolean {
      const absolutePath = expandPath(filePath, homeDir);
      return absolutePath in files || directories.has(absolutePath);
    },

    getContent(filePath: string): string | undefined {
      const absolutePath = expandPath(filePath, homeDir);
      return files[absolutePath];
    },

    async readFile(filePath: string, encoding: "utf8"): Promise<string> {
      void encoding; // TypeScript satisfaction
      const absolutePath = expandPath(filePath, homeDir);
      if (!(absolutePath in files)) {
        const error = new Error(`ENOENT: no such file or directory, open '${absolutePath}'`);
        (error as NodeJS.ErrnoException).code = "ENOENT";
        throw error;
      }
      return files[absolutePath];
    },

    async writeFile(
      filePath: string,
      content: string,
      options?: { encoding: "utf8" }
    ): Promise<void> {
      void options; // TypeScript satisfaction
      const absolutePath = expandPath(filePath, homeDir);

      // Ensure parent directory exists
      const parentDir = path.dirname(absolutePath);
      if (!directories.has(parentDir)) {
        const error = new Error(`ENOENT: no such file or directory, open '${absolutePath}'`);
        (error as NodeJS.ErrnoException).code = "ENOENT";
        throw error;
      }

      files[absolutePath] = content;
    },

    async mkdir(dirPath: string, options?: { recursive: boolean }): Promise<void> {
      const absolutePath = expandPath(dirPath, homeDir);

      if (options?.recursive) {
        addDirectoryTree(absolutePath, directories);
      } else {
        // Check parent exists
        const parentDir = path.dirname(absolutePath);
        if (parentDir !== absolutePath && !directories.has(parentDir)) {
          const error = new Error(`ENOENT: no such file or directory, mkdir '${absolutePath}'`);
          (error as NodeJS.ErrnoException).code = "ENOENT";
          throw error;
        }
        directories.add(absolutePath);
      }
    },

    async unlink(filePath: string): Promise<void> {
      const absolutePath = expandPath(filePath, homeDir);
      if (!(absolutePath in files)) {
        const error = new Error(`ENOENT: no such file or directory, unlink '${absolutePath}'`);
        (error as NodeJS.ErrnoException).code = "ENOENT";
        throw error;
      }
      delete files[absolutePath];
    },

    async stat(filePath: string): Promise<{ mode?: number }> {
      const absolutePath = expandPath(filePath, homeDir);
      if (absolutePath in files) {
        return { mode: 0o644 };
      }
      if (directories.has(absolutePath)) {
        return { mode: 0o755 };
      }
      const error = new Error(`ENOENT: no such file or directory, stat '${absolutePath}'`);
      (error as NodeJS.ErrnoException).code = "ENOENT";
      throw error;
    },

    async chmod(filePath: string, mode: number): Promise<void> {
      void mode; // In mock fs, we don't actually store mode changes
      const absolutePath = expandPath(filePath, homeDir);
      if (!(absolutePath in files) && !directories.has(absolutePath)) {
        const error = new Error(`ENOENT: no such file or directory, chmod '${absolutePath}'`);
        (error as NodeJS.ErrnoException).code = "ENOENT";
        throw error;
      }
      // Mode change is a no-op in mock fs but we don't throw
    }
  };

  return mockFs;
}

/**
 * Expand ~ to homeDir in a path.
 */
function expandPath(inputPath: string, homeDir: string): string {
  if (inputPath.startsWith("~/")) {
    return path.join(homeDir, inputPath.slice(2));
  }
  if (inputPath === "~") {
    return homeDir;
  }
  if (inputPath.startsWith("~")) {
    // ~something (not ~/) - treat as relative path from home
    return path.join(homeDir, inputPath.slice(1));
  }
  return inputPath;
}

/**
 * Add a directory and all its parent directories to the set.
 */
function addDirectoryTree(dirPath: string, directories: Set<string>): void {
  const parts = dirPath.split(path.sep).filter(Boolean);
  let current = "/";
  directories.add(current);

  for (const part of parts) {
    current = path.join(current, part);
    directories.add(current);
  }
}
