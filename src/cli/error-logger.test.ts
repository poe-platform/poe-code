import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { ErrorLogger } from "./error-logger.js";

function createErofsError(message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = "EROFS";
  return error;
}

function createSyncFs(initialFiles: Record<string, string>): any {
  const vol = Volume.fromJSON(initialFiles);
  return createFsFromVolume(vol);
}

describe("ErrorLogger (read-only environments)", () => {
  const logDir = "/root/.poe-code/logs";
  const logFile = path.join(logDir, "errors.log");
  const now = () => new Date("2024-01-01T00:00:00.000Z");
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("falls back to stderr and stops writing once append fails", () => {
    const fs = createSyncFs({ [logFile]: "" });
    const appendSpy = vi
      .spyOn(fs, "appendFileSync")
      .mockImplementation(() => {
        throw createErofsError("append");
      });

    const logger = new ErrorLogger({
      fs,
      logDir,
      logToStderr: false,
      now
    });

    logger.logError(new Error("first failure"));

    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("ERROR: first failure");
    expect(consoleErrorSpy.mock.calls[0][0]).not.toContain(
      "Failed to write to error log file"
    );

    consoleErrorSpy.mockClear();
    logger.logError(new Error("second failure"));

    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("second failure");
  });

  it("disables file logging entirely when initialization fails", () => {
    const fs = createSyncFs({});

    vi.spyOn(fs, "existsSync").mockImplementation((target: string) => {
      if (target === logDir) {
        return false;
      }
      if (target === logFile) {
        return false;
      }
      return false;
    });

    const mkdirSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => {
      throw createErofsError("mkdir");
    });

    const appendSpy = vi.spyOn(fs, "appendFileSync");

    const logger = new ErrorLogger({
      fs,
      logDir,
      logToStderr: false,
      now
    });

    expect(mkdirSpy).toHaveBeenCalledTimes(1);

    logger.logError("run command");

    expect(appendSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("ERROR: run command");
  });
});
