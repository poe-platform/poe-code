import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import chalk from "chalk";
import { SilentError } from "./errors.js";
import * as designSystemModule from "@poe-code/design-system";

describe("createLoggerFactory", () => {
  let logMessageSpy: ReturnType<typeof vi.spyOn>;
  let logWarnSpy: ReturnType<typeof vi.spyOn>;
  let logErrorSpy: ReturnType<typeof vi.spyOn>;
  let noteSpy: ReturnType<typeof vi.spyOn>;
  let introSpy: ReturnType<typeof vi.spyOn>;
  let introPlainSpy: ReturnType<typeof vi.spyOn>;
  let outroSpy: ReturnType<typeof vi.spyOn>;
  let resolveOutputFormatSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logMessageSpy = vi.spyOn(designSystemModule.log, "message").mockImplementation(() => {});
    logWarnSpy = vi.spyOn(designSystemModule.log, "warn").mockImplementation(() => {});
    logErrorSpy = vi.spyOn(designSystemModule.log, "error").mockImplementation(() => {});
    noteSpy = vi.spyOn(designSystemModule, "note" as any).mockImplementation(() => {});
    introSpy = vi.spyOn(designSystemModule, "intro" as any).mockImplementation(() => {});
    introPlainSpy = vi.spyOn(designSystemModule, "introPlain" as any).mockImplementation(() => {});
    outroSpy = vi.spyOn(designSystemModule, "outro" as any).mockImplementation(() => {});
    resolveOutputFormatSpy = vi.spyOn(designSystemModule, "resolveOutputFormat" as any).mockReturnValue("terminal");
  });

  afterEach(() => {
    logMessageSpy?.mockRestore();
    logWarnSpy?.mockRestore();
    logErrorSpy?.mockRestore();
    noteSpy?.mockRestore();
    introSpy?.mockRestore();
    introPlainSpy?.mockRestore();
    outroSpy?.mockRestore();
    resolveOutputFormatSpy?.mockRestore();
  });

  it("uses purple symbols for info and success without a custom emitter", async () => {
    const { createLoggerFactory } = await import("./logger.js");
    const logger = createLoggerFactory().create();

    logger.info("Hello");
    logger.success("Done");

    expect(logMessageSpy).toHaveBeenCalledWith("Hello", {
      symbol: chalk.magenta("●")
    });
    expect(logMessageSpy).toHaveBeenCalledWith("Done", {
      symbol: chalk.magenta("◆")
    });
  });

  it("renders nextSteps as a clack note box", async () => {
    const { createLoggerFactory } = await import("./logger.js");
    const logger = createLoggerFactory().create();

    logger.nextSteps(["cd ./my-project", "pnpm dev"]);

    expect(noteSpy).toHaveBeenCalledWith(
      "cd ./my-project\npnpm dev",
      "Next steps."
    );
  });

  it("skips nextSteps when array is empty", async () => {
    const { createLoggerFactory } = await import("./logger.js");
    const logger = createLoggerFactory().create();

    logger.nextSteps([]);

    expect(noteSpy).not.toHaveBeenCalled();
  });

  it("renders intro as a clack intro header", async () => {
    const { createLoggerFactory } = await import("./logger.js");
    const logger = createLoggerFactory().create();

    logger.intro("configure claude-code");

    expect(introSpy).toHaveBeenCalledWith("configure claude-code");
  });

  it("applies theme formatting to intro", async () => {
    const { createLoggerFactory } = await import("./logger.js");
    const theme = { intro: (text: string) => `[STYLED:${text}]` };
    const logger = createLoggerFactory(undefined, theme).create();

    logger.intro("configure claude-code");

    expect(introPlainSpy).toHaveBeenCalledWith("[STYLED:configure claude-code]");
  });

  it("renders resolved option with label and value", async () => {
    const { createLoggerFactory } = await import("./logger.js");
    const logger = createLoggerFactory().create();

    logger.resolved("Model", "Claude-Opus-4.6");

    expect(logMessageSpy).toHaveBeenCalledWith("Model\n   Claude-Opus-4.6", {
      symbol: chalk.magenta("◇")
    });
  });

  it("renders errorResolved with label and value using red square symbol", async () => {
    const { createLoggerFactory } = await import("./logger.js");
    const logger = createLoggerFactory().create();

    logger.errorResolved("Configuration Failed", "Missing API key");

    expect(logMessageSpy).toHaveBeenCalledWith(
      "Configuration Failed\n   Missing API key",
      { symbol: chalk.red("■") }
    );
  });

  it("renders verbose messages without a symbol when verbose is enabled", async () => {
    const { createLoggerFactory } = await import("./logger.js");
    const logger = createLoggerFactory().create({ verbose: true });

    logger.verbose("Create /path/to/dir");

    expect(logMessageSpy).toHaveBeenCalledWith("Create /path/to/dir", {
      symbol: chalk.gray("│")
    });
  });

  it("does not render verbose messages when verbose is disabled", async () => {
    const { createLoggerFactory } = await import("./logger.js");
    const logger = createLoggerFactory().create({ verbose: false });

    logger.verbose("Create /path/to/dir");

    expect(logMessageSpy).not.toHaveBeenCalled();
  });

  it("includes scope in verbose messages when both scope and verbose are set", async () => {
    const { createLoggerFactory } = await import("./logger.js");
    const logger = createLoggerFactory().create({
      verbose: true,
      scope: "configure:opencode"
    });

    logger.verbose("Create /path/to/dir");

    expect(logMessageSpy).toHaveBeenCalledWith(
      "[configure:opencode] Create /path/to/dir",
      { symbol: chalk.gray("│") }
    );
  });

  it("renders feedback link as dimmed outro", async () => {
    const { createLoggerFactory } = await import("./logger.js");
    const logger = createLoggerFactory().create();

    logger.feedback("Problems?", "https://example.com/issues");

    expect(outroSpy).toHaveBeenCalledWith(
      chalk.dim("Problems? https://example.com/issues")
    );
  });

  it("does not log exceptions for silent errors", async () => {
    const { createLoggerFactory } = await import("./logger.js");
    const logger = createLoggerFactory().create();

    logger.logException(
      new SilentError("Operation cancelled."),
      "login command"
    );

    expect(logErrorSpy).not.toHaveBeenCalled();
    expect(logMessageSpy).not.toHaveBeenCalled();
  });

  it("does not log exceptions for OperationCancelledError by name", async () => {
    const { createLoggerFactory } = await import("./logger.js");
    const logger = createLoggerFactory().create();
    const error = new Error("Operation cancelled.");
    error.name = "OperationCancelledError";

    logger.logException(error, "login command");

    expect(logErrorSpy).not.toHaveBeenCalled();
    expect(logMessageSpy).not.toHaveBeenCalled();
  });
});
