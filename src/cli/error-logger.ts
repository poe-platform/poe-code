import path from "node:path";

type SyncFileSystem = {
  appendFileSync(file: string, data: string): void;
  existsSync(path: string): boolean;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  realpathSync(path: string): string;
  renameSync(oldPath: string, newPath: string): void;
  statSync(path: string): { size: number };
  unlinkSync(path: string): void;
  writeFileSync(path: string, data: string, options?: { encoding?: BufferEncoding }): void;
};

export interface ErrorContext {
  operation?: string;
  component?: string;
  apiEndpoint?: string;
  httpStatus?: number;
  requestBody?: unknown;
  responseBody?: unknown;
  [key: string]: unknown;
}

export interface ErrorLogEntry {
  timestamp: string;
  level: "ERROR" | "WARN";
  message: string;
  stack?: string;
  context?: ErrorContext;
}

export interface ErrorLoggerOptions {
  fs: SyncFileSystem;
  logDir: string;
  logToStderr?: boolean;
  maxSize?: number;
  maxBackups?: number;
  now?: () => Date;
}

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_BACKUPS = 5;

export class ErrorLogger {
  private readonly fs: SyncFileSystem;
  private readonly logFilePath: string;
  private readonly logToStderr: boolean;
  private readonly maxSize: number;
  private readonly maxBackups: number;
  private readonly now: () => Date;
  private fileLoggingAvailable: boolean | undefined;

  constructor(options: ErrorLoggerOptions) {
    this.fs = options.fs;
    this.logFilePath = path.join(options.logDir, "errors.log");
    this.logToStderr = options.logToStderr ?? true;
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this.maxBackups = options.maxBackups ?? DEFAULT_MAX_BACKUPS;
    this.now = options.now ?? (() => new Date());
  }

  logError(error: Error | string, context?: ErrorContext): void {
    const entry = this.createErrorEntry(error, "ERROR", context);
    this.writeEntry(entry);

    if (this.logToStderr) {
      this.writeToStderr(entry);
    }
  }

  logWarning(message: string, context?: ErrorContext): void {
    const entry = this.createWarningEntry(message, context);
    this.writeEntry(entry);

    if (this.logToStderr) {
      this.writeToStderr(entry);
    }
  }

  logErrorWithStackTrace(
    error: Error,
    operation: string,
    context?: ErrorContext
  ): void {
    const fullContext: ErrorContext = {
      ...context,
      operation
    };

    this.logError(error, fullContext);
  }

  private createErrorEntry(
    error: Error | string,
    level: "ERROR" | "WARN",
    context?: ErrorContext
  ): ErrorLogEntry {
    const errorObj = typeof error === "string" ? new Error(error) : error;

    return {
      timestamp: this.now().toISOString(),
      level,
      message: errorObj.message,
      stack: errorObj.stack,
      context
    };
  }

  private createWarningEntry(
    message: string,
    context?: ErrorContext
  ): ErrorLogEntry {
    return {
      timestamp: this.now().toISOString(),
      level: "WARN",
      message,
      context
    };
  }

  private writeEntry(entry: ErrorLogEntry): void {
    if (this.fileLoggingAvailable === undefined) {
      this.fileLoggingAvailable = this.ensureLogDirectory();
    }

    if (!this.fileLoggingAvailable) {
      this.writeToStderr(entry, true);
      return;
    }

    this.rotateIfNeeded();

    const formattedEntry = this.formatEntry(entry);
    try {
      this.fs.appendFileSync(this.logFilePath, formattedEntry + "\n");
    } catch {
      this.fileLoggingAvailable = false;
      this.writeToStderr(entry, true);
    }
  }

  private formatEntry(entry: ErrorLogEntry): string {
    const parts = [`[${entry.timestamp}] ${entry.level}: ${entry.message}`];

    if (entry.context && Object.keys(entry.context).length > 0) {
      parts.push(`Context: ${JSON.stringify(entry.context)}`);
    }

    if (entry.stack) {
      parts.push(`Stack trace:\n${entry.stack}`);
    }

    return parts.join("\n");
  }

  private writeToStderr(entry: ErrorLogEntry, force = false): void {
    if (!this.logToStderr && !force) {
      return;
    }

    const formatted = this.formatEntry(entry);
    console.error(formatted);
  }

  private rotateIfNeeded(): void {
    if (!this.fileLoggingAvailable) {
      return;
    }

    try {
      if (!this.fs.existsSync(this.logFilePath)) {
        return;
      }

      const stats = this.fs.statSync(this.logFilePath);
      if (stats.size < this.maxSize) {
        return;
      }

      this.performRotation();
    } catch (error) {
      console.error("Error during log rotation:", error);
    }
  }

  private performRotation(): void {
    if (this.maxBackups < 1) {
      this.fs.unlinkSync(this.logFilePath);
      return;
    }

    const moves = [
      { source: this.logFilePath, target: this.buildBackupPath(1) },
      ...Array.from({ length: this.maxBackups - 1 }, (_, index) => ({
        source: this.buildBackupPath(index + 1),
        target: this.buildBackupPath(index + 2)
      })),
      { source: this.buildBackupPath(this.maxBackups), target: undefined }
    ]
      .filter(({ source }) => this.fs.existsSync(source))
      .map(({ source, target }, index) => {
        let tempPath = `${this.logFilePath}.rotation-tmp-${index}`;
        while (this.fs.existsSync(tempPath)) {
          tempPath += "-next";
        }
        return { source, target, tempPath, staged: false, committed: false };
      });

    try {
      for (const move of moves) {
        this.fs.renameSync(move.source, move.tempPath);
        move.staged = true;
      }

      for (const move of moves) {
        if (move.target) {
          this.fs.renameSync(move.tempPath, move.target);
          move.committed = true;
        } else {
          this.fs.unlinkSync(move.tempPath);
          move.staged = false;
        }
      }
    } catch (error) {
      for (const move of moves) {
        try {
          if (move.committed && move.target) {
            this.fs.renameSync(move.target, move.tempPath);
            move.committed = false;
          }
        } catch (rollbackError) {
          void rollbackError;
        }
      }

      for (const move of [...moves].reverse()) {
        try {
          if (move.staged) {
            this.fs.renameSync(move.tempPath, move.source);
            move.staged = false;
          }
        } catch (rollbackError) {
          void rollbackError;
        }
      }
      throw error;
    }
  }

  private buildBackupPath(index: number): string {
    return `${this.logFilePath}.${index}`;
  }

  private ensureLogDirectory(): boolean {
    const directory = path.dirname(this.logFilePath);
    try {
      let existingAncestor = directory;
      while (!this.fs.existsSync(existingAncestor)) {
        const parent = path.dirname(existingAncestor);
        if (parent === existingAncestor) {
          return false;
        }
        existingAncestor = parent;
      }

      if (this.fs.realpathSync(existingAncestor) !== path.resolve(existingAncestor)) {
        return false;
      }

      if (!this.fs.existsSync(directory)) {
        this.fs.mkdirSync(directory, { recursive: true });
      }

      if (this.fs.realpathSync(directory) !== path.resolve(directory)) {
        return false;
      }

      if (!this.fs.existsSync(this.logFilePath)) {
        this.fs.writeFileSync(this.logFilePath, "", { encoding: "utf8" });
      } else if (this.fs.realpathSync(this.logFilePath) !== path.resolve(this.logFilePath)) {
        return false;
      }

      return true;
    } catch {
      // Silently fail during directory creation - this is expected in test environments
      // where the log directory path may not exist. The logger will still function,
      // just without file logging capability.
      return false;
    }
  }
}
