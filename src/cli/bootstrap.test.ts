import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Command } from "commander";
import { CommanderError } from "commander";
import { OperationCancelledError, ReportedError, SilentError } from "./errors.js";
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

vi.mock("toolcraft-design", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("toolcraft-design");
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
  let originalArgv: string[];

  beforeEach(() => {
    capturedOptions = undefined;
    logErrorWithStackTrace.mockReset();
    originalEnvValue = process.env.POE_CODE_STDERR_LOGS;
    originalArgv = process.argv;
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
    process.argv = originalArgv;
    vi.clearAllMocks();
  });

  it("enables stderr logging for bootstrap errors", async () => {
    const parseAsync = vi.fn(async () => {
      throw new Error("boom");
    });

    const fakeProgram: Partial<Command> & { parseAsync: () => Promise<void> } = {
      parseAsync,
      optsWithGlobals: () => ({ dryRun: false })
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

  it("normalizes sandbox-shaped errors before logging and rendering them", async () => {
    const parseAsync = vi.fn(async () => {
      throw {
        name: "Error",
        message: "sandbox failure",
        stack: "Error: sandbox failure\n    at spawn (line 1, column 1)"
      };
    });
    const fakeProgram: Partial<Command> & { parseAsync: () => Promise<void> } = {
      parseAsync,
      optsWithGlobals: () => ({ dryRun: false })
    };
    const { log } = await import("toolcraft-design");
    const { createCliMain } = await import("./bootstrap.js");
    const main = createCliMain(() => fakeProgram as Command);

    await expect(main()).rejects.toThrow("exit:1");

    expect(logErrorWithStackTrace).toHaveBeenCalledWith(
      expect.objectContaining({ message: "sandbox failure" }),
      "CLI execution",
      expect.objectContaining({ component: "main" })
    );
    expect(vi.mocked(log.error)).toHaveBeenCalledWith("Error: sandbox failure");
  });

  it("renders generic errors as bounded control-safe terminal text", async () => {
    const rawMessage = `sandbox failure\n\u001b[31m${"detail ".repeat(100)}`;
    const parseAsync = vi.fn(async () => {
      throw new Error(rawMessage);
    });
    const fakeProgram: Partial<Command> & { parseAsync: () => Promise<void> } = {
      parseAsync,
      optsWithGlobals: () => ({ dryRun: false })
    };
    const { log } = await import("toolcraft-design");
    const { createCliMain } = await import("./bootstrap.js");
    const main = createCliMain(() => fakeProgram as Command);

    await expect(main()).rejects.toThrow("exit:1");

    expect(logErrorWithStackTrace).toHaveBeenCalledWith(
      expect.objectContaining({ message: rawMessage }),
      "CLI execution",
      expect.objectContaining({ component: "main" })
    );
    const rendered = vi.mocked(log.error).mock.calls[0][0];
    expect(rendered).toContain("Error: sandbox failure\n[31m");
    expect(rendered).toContain("\n");
    expect(rendered).not.toContain("\u001b");
    expect(rendered.length).toBeLessThanOrEqual(1207);
  });

  it("redacts sensitive argv values before logging bootstrap errors", async () => {
    process.argv = [
      "node",
      "poe-code",
      "provider",
      "login",
      "anthropic",
      "--api-key",
      "sk-ant-secret",
      "--token=token-secret",
      "--client-secret=client-value-123",
      "--password",
      "pw-secret",
      "--safe",
      "visible"
    ];
    const parseAsync = vi.fn(async () => {
      throw new Error("login failed");
    });
    const fakeProgram: Partial<Command> & { parseAsync: () => Promise<void> } = {
      parseAsync,
      optsWithGlobals: () => ({ dryRun: false })
    };

    const { createCliMain } = await import("./bootstrap.js");
    const main = createCliMain(() => fakeProgram as Command);

    await expect(main()).rejects.toThrow("exit:1");

    expect(parseAsync).toHaveBeenCalledWith(process.argv);
    const context = logErrorWithStackTrace.mock.calls[0][2] as { argv: string[] };
    expect(context.argv).toEqual([
      "node",
      "poe-code",
      "provider",
      "login",
      "anthropic",
      "--api-key",
      "[redacted]",
      "--token=[redacted]",
      "--client-secret=[redacted]",
      "--password",
      "[redacted]",
      "--safe",
      "visible"
    ]);
    expect(JSON.stringify(context)).not.toContain("sk-ant-secret");
    expect(JSON.stringify(context)).not.toContain("token-secret");
    expect(JSON.stringify(context)).not.toContain("client-value-123");
    expect(JSON.stringify(context)).not.toContain("pw-secret");
  });

  it("does not persist diagnostics for dry-run command failures", async () => {
    process.argv = ["node", "poe-code", "--dry-run", "runtime", "build", "--runtime", "host"];
    const parseAsync = vi.fn(async () => {
      throw new Error("Host runtime has no template to build.");
    });
    const fakeProgram: Partial<Command> & { parseAsync: () => Promise<void> } = {
      parseAsync,
      optsWithGlobals: () => ({ dryRun: true })
    };
    const { log } = await import("toolcraft-design");
    const { createCliMain } = await import("./bootstrap.js");
    const main = createCliMain(() => fakeProgram as Command);

    await expect(main()).rejects.toThrow("exit:1");

    expect(logErrorWithStackTrace).not.toHaveBeenCalled();
    expect(vi.mocked(log.message)).not.toHaveBeenCalled();
  });

  it("exits without rendering or logging errors already reported by a command", async () => {
    const parseAsync = vi.fn(async () => {
      throw new ReportedError("already shown");
    });
    const fakeProgram: Partial<Command> & { parseAsync: () => Promise<void> } = {
      parseAsync,
      optsWithGlobals: () => ({ dryRun: false })
    };
    const { log } = await import("toolcraft-design");
    const { createCliMain } = await import("./bootstrap.js");
    const main = createCliMain(() => fakeProgram as Command);

    await expect(main()).rejects.toThrow("exit:1");

    expect(logErrorWithStackTrace).not.toHaveBeenCalled();
    expect(vi.mocked(log.error)).not.toHaveBeenCalled();
    expect(vi.mocked(log.message)).not.toHaveBeenCalled();
  });

  it("still persists diagnostics when dry-run is only a forwarded argument", async () => {
    process.argv = ["node", "poe-code", "wrap", "opencode", "--", "--dry-run"];
    const parseAsync = vi.fn(async () => {
      throw new Error("wrapped command failed");
    });
    const fakeProgram: Partial<Command> & { parseAsync: () => Promise<void> } = {
      parseAsync,
      optsWithGlobals: () => ({ dryRun: false })
    };
    const { createCliMain } = await import("./bootstrap.js");
    const main = createCliMain(() => fakeProgram as Command);

    await expect(main()).rejects.toThrow("exit:1");

    expect(logErrorWithStackTrace).toHaveBeenCalled();
  });

  it("does not treat commander version exit as an error", async () => {
    const parseAsync = vi.fn(async () => {
      throw new VersionExit();
    });

    const fakeProgram: Partial<Command> & { parseAsync: () => Promise<void> } = {
      parseAsync,
      optsWithGlobals: () => ({ dryRun: false })
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
      parseAsync,
      optsWithGlobals: () => ({ dryRun: false })
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
