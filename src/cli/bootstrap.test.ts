import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import type { Command } from "commander";
import { CommanderError } from "commander";
import { OperationCancelledError, SilentError } from "./errors.js";
import { VersionExit } from "./exit-signals.js";
import * as designSystemModule from "@poe-code/design-system";
import * as errorLoggerModule from "./error-logger.js";

describe("createCliMain", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logErrorSpy: ReturnType<typeof vi.spyOn>;
  let logMessageSpy: ReturnType<typeof vi.spyOn>;
  let errorLoggerSpy: ReturnType<typeof vi.spyOn>;
  let logErrorWithStackTrace: ReturnType<typeof vi.fn>;
  let capturedOptions: any;
  let originalEnvValue: string | undefined;

  beforeEach(() => {
    capturedOptions = undefined;
    logErrorWithStackTrace = vi.fn();
    originalEnvValue = process.env.POE_CODE_STDERR_LOGS;
    process.env.POE_CODE_STDERR_LOGS = "1";
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((code?: string | number | null) => {
        throw new Error(`exit:${code ?? "undefined"}`);
      });
    logErrorSpy = vi.spyOn(designSystemModule.log, "error").mockImplementation(() => {});
    logMessageSpy = vi.spyOn(designSystemModule.log, "message").mockImplementation(() => {});
    errorLoggerSpy = vi.spyOn(errorLoggerModule, "ErrorLogger" as any).mockImplementation(
      (options: any) => {
        capturedOptions = options;
        return { logErrorWithStackTrace };
      }
    );
  });

  afterEach(() => {
    if (originalEnvValue === undefined) {
      delete process.env.POE_CODE_STDERR_LOGS;
    } else {
      process.env.POE_CODE_STDERR_LOGS = originalEnvValue;
    }
    exitSpy.mockRestore();
    logErrorSpy?.mockRestore();
    logMessageSpy?.mockRestore();
    errorLoggerSpy?.mockRestore();
    vi.clearAllMocks();
  });

  it("enables stderr logging for bootstrap errors", async () => {
    const parseAsync = vi.fn(async () => {
      throw new Error("boom");
    });

    const fakeProgram: Partial<Command> & { parseAsync: () => Promise<void> } = {
      parseAsync
    };

    const { createCliMain } = await import("./bootstrap.js");
    const main = createCliMain(() => fakeProgram as Command);

    await expect(main()).rejects.toThrow("exit:1");

    expect(parseAsync).toHaveBeenCalled();
    expect(logErrorWithStackTrace).toHaveBeenCalledWith(
      expect.any(Error),
      "CLI execution",
      expect.objectContaining({ component: "main" })
    );
    expect(capturedOptions).toMatchObject({ logToStderr: true });
  });

  it("does not treat commander version exit as an error", async () => {
    const parseAsync = vi.fn(async () => {
      throw new VersionExit();
    });

    const fakeProgram: Partial<Command> & { parseAsync: () => Promise<void> } = {
      parseAsync
    };

    const { createCliMain } = await import("./bootstrap.js");
    const main = createCliMain(() => fakeProgram as Command);

    await expect(main()).resolves.toBeUndefined();

    expect(parseAsync).toHaveBeenCalled();
    expect(logErrorWithStackTrace).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("still logs other commander errors even with exitCode 0", async () => {
    const parseAsync = vi.fn(async () => {
      throw new CommanderError(0, "commander.other", "boom");
    });

    const fakeProgram: Partial<Command> & { parseAsync: () => Promise<void> } = {
      parseAsync
    };

    const { createCliMain } = await import("./bootstrap.js");
    const main = createCliMain(() => fakeProgram as Command);

    await expect(main()).rejects.toThrow("exit:1");

    expect(logErrorWithStackTrace).toHaveBeenCalledWith(
      expect.any(Error),
      "CLI execution",
      expect.objectContaining({ component: "main" })
    );
  });

  it("does not treat silent exits as errors", async () => {
    class TestExit extends SilentError {
      constructor() {
        super("");
        this.name = "TestExit";
      }
    }

    const parseAsync = vi.fn(async () => {
      throw new TestExit();
    });

    const fakeProgram: Partial<Command> & { parseAsync: () => Promise<void> } = {
      parseAsync
    };

    const { createCliMain } = await import("./bootstrap.js");
    const main = createCliMain(() => fakeProgram as Command);

    await expect(main()).resolves.toBeUndefined();

    expect(logErrorWithStackTrace).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does not treat operation cancellation as an error", async () => {
    const parseAsync = vi.fn(async () => {
      throw new OperationCancelledError();
    });

    const fakeProgram: Partial<Command> & { parseAsync: () => Promise<void> } = {
      parseAsync
    };

    const { createCliMain } = await import("./bootstrap.js");
    const main = createCliMain(() => fakeProgram as Command);

    await expect(main()).resolves.toBeUndefined();

    expect(logErrorWithStackTrace).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does not treat operation cancellation as an error by name", async () => {
    const parseAsync = vi.fn(async () => {
      const error = new Error("Operation cancelled.");
      error.name = "OperationCancelledError";
      throw error;
    });

    const fakeProgram: Partial<Command> & { parseAsync: () => Promise<void> } = {
      parseAsync
    };

    const { createCliMain } = await import("./bootstrap.js");
    const main = createCliMain(() => fakeProgram as Command);

    await expect(main()).resolves.toBeUndefined();

    expect(logErrorWithStackTrace).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
