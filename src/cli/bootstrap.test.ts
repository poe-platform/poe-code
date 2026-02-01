import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Command } from "commander";
import { CommanderError } from "commander";
import { OperationCancelledError, SilentError } from "./errors.js";
import { VersionExit } from "./exit-signals.js";

const logErrorWithStackTrace = vi.fn();
let capturedOptions: any;

vi.mock("./error-logger.js", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "./error-logger.js"
  );
  return {
    ...actual,
    ErrorLogger: class MockErrorLogger {
      constructor(options: any) {
        capturedOptions = options;
      }
      logErrorWithStackTrace = logErrorWithStackTrace;
    }
  };
});

vi.mock("@poe-code/design-system", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@poe-code/design-system");
  return {
    ...actual,
    log: {
      error: vi.fn(),
      message: vi.fn()
    }
  };
});

describe("createCliMain", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let originalEnvValue: string | undefined;

  beforeEach(() => {
    capturedOptions = undefined;
    logErrorWithStackTrace.mockReset();
    originalEnvValue = process.env.POE_CODE_STDERR_LOGS;
    process.env.POE_CODE_STDERR_LOGS = "1";
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((code?: string | number | null) => {
        throw new Error(`exit:${code ?? "undefined"}`);
      });
  });

  afterEach(() => {
    if (originalEnvValue === undefined) {
      delete process.env.POE_CODE_STDERR_LOGS;
    } else {
      process.env.POE_CODE_STDERR_LOGS = originalEnvValue;
    }
    exitSpy.mockRestore();
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
});
