import { describe, it, expect, vi, beforeEach } from "vitest";
import chalk from "chalk";
import { SilentError, ValidationError } from "./errors.js";

const logMessage = vi.hoisted(() => vi.fn());
const logWarn = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
const noteFn = vi.hoisted(() => vi.fn());
const introFn = vi.hoisted(() => vi.fn());
const introPlainFn = vi.hoisted(() => vi.fn());
const outroFn = vi.hoisted(() => vi.fn());
const resolveOutputFormatFn = vi.hoisted(() => vi.fn(() => "terminal"));

vi.mock("toolcraft-design", () => ({
  log: {
    info: logMessage,
    success: logMessage,
    message: logMessage,
    warn: logWarn,
    error: logError
  },
  note: noteFn,
  intro: introFn,
  introPlain: introPlainFn,
  outro: outroFn,
  resolveOutputFormat: resolveOutputFormatFn
}));

import { createLoggerFactory } from "./logger.js";

describe("createLoggerFactory", () => {
  beforeEach(() => {
    logMessage.mockClear();
    logWarn.mockClear();
    logError.mockClear();
    noteFn.mockClear();
    introFn.mockClear();
    introPlainFn.mockClear();
    outroFn.mockClear();
    resolveOutputFormatFn.mockReturnValue("terminal");
  });

  it("distinguishes info and success by colour without a custom emitter", () => {
    const logger = createLoggerFactory().create();

    logger.info("Hello");
    logger.success("Done");

    expect(logMessage).toHaveBeenCalledWith("Hello", {
      symbol: chalk.magenta("●")
    });
    expect(logMessage).toHaveBeenCalledWith("Done", {
      symbol: chalk.green("◆")
    });
  });

  it("delegates non-terminal messages to structured design-system loggers", () => {
    resolveOutputFormatFn.mockReturnValue("json");
    const logger = createLoggerFactory().create({ verbose: true });

    logger.info("Hello");
    logger.success("Done");
    logger.warn("Careful");
    logger.error("Failed");
    logger.verbose("Details");
    logger.resolved("Model", "Claude-Opus-4.7");
    logger.errorResolved("Configuration Failed", "Missing API key");

    expect(logMessage).toHaveBeenCalledWith("Hello");
    expect(logMessage).toHaveBeenCalledWith("Done");
    expect(logWarn).toHaveBeenCalledWith("Careful");
    expect(logError).toHaveBeenCalledWith("Failed");
    expect(logMessage).toHaveBeenCalledWith("Details");
    expect(logMessage).toHaveBeenCalledWith("Model: Claude-Opus-4.7");
    expect(logError).toHaveBeenCalledWith("Configuration Failed: Missing API key");
  });

  it("renders nextSteps as a clack note box", () => {
    const logger = createLoggerFactory().create();

    logger.nextSteps(["cd ./my-project", "pnpm dev"]);

    expect(noteFn).toHaveBeenCalledWith(
      "cd ./my-project\npnpm dev",
      "Next steps."
    );
  });

  it("skips nextSteps when array is empty", () => {
    const logger = createLoggerFactory().create();

    logger.nextSteps([]);

    expect(noteFn).not.toHaveBeenCalled();
  });

  it("renders intro as a clack intro header", () => {
    const logger = createLoggerFactory().create();

    logger.intro("configure claude-code");

    expect(introFn).toHaveBeenCalledWith("configure claude-code");
  });

  it("applies theme formatting to intro", () => {
    const theme = { intro: (text: string) => `[STYLED:${text}]` };
    const logger = createLoggerFactory(undefined, theme).create();

    logger.intro("configure claude-code");

    expect(introPlainFn).toHaveBeenCalledWith("[STYLED:configure claude-code]");
  });

  it("renders resolved option with label and value", () => {
    const logger = createLoggerFactory().create();

    logger.resolved("Model", "Claude-Opus-4.6");

    expect(logMessage).toHaveBeenCalledWith("Model\n   Claude-Opus-4.6", {
      symbol: chalk.magenta("◇")
    });
  });

  it("renders errorResolved with label and value using red square symbol", () => {
    const logger = createLoggerFactory().create();

    logger.errorResolved("Configuration Failed", "Missing API key");

    expect(logMessage).toHaveBeenCalledWith(
      "Configuration Failed\n   Missing API key",
      { symbol: chalk.red("■") }
    );
  });

  it("renders verbose messages without a symbol when verbose is enabled", () => {
    const logger = createLoggerFactory().create({ verbose: true });

    logger.verbose("Create /path/to/dir");

    expect(logMessage).toHaveBeenCalledWith("Create /path/to/dir", {
      symbol: chalk.gray("│")
    });
  });

  it("does not render verbose messages when verbose is disabled", () => {
    const logger = createLoggerFactory().create({ verbose: false });

    logger.verbose("Create /path/to/dir");

    expect(logMessage).not.toHaveBeenCalled();
  });

  it("does not tag rendered info content with the scope when verbose", () => {
    const logger = createLoggerFactory().create({
      verbose: true,
      scope: "models"
    });

    logger.info("model  created\nClaude-Sonnet-4.5  2025-09-29");

    expect(logMessage).toHaveBeenCalledWith(
      "model  created\nClaude-Sonnet-4.5  2025-09-29",
      { symbol: chalk.magenta("●") }
    );
  });

  it("skips verbose messages that carry no text", () => {
    const logger = createLoggerFactory().create({
      verbose: true,
      scope: "spawn:claude-code"
    });

    logger.verbose("   ");

    expect(logMessage).not.toHaveBeenCalled();
  });

  it("includes scope in verbose messages when both scope and verbose are set", () => {
    const logger = createLoggerFactory().create({
      verbose: true,
      scope: "configure:opencode"
    });

    logger.verbose("Create /path/to/dir");

    expect(logMessage).toHaveBeenCalledWith(
      "[configure:opencode] Create /path/to/dir",
      { symbol: chalk.gray("│") }
    );
  });

  it("renders feedback link as dimmed outro", () => {
    const logger = createLoggerFactory().create();

    logger.feedback("Problems?", "https://example.com/issues");

    expect(outroFn).toHaveBeenCalledWith(
      chalk.dim("Problems? https://example.com/issues")
    );
  });

  it("does not log exceptions for silent errors", () => {
    const logger = createLoggerFactory().create();

    logger.logException(
      new SilentError("Operation cancelled."),
      "login command"
    );

    expect(logError).not.toHaveBeenCalled();
    expect(logMessage).not.toHaveBeenCalled();
  });

  it("reports user errors without stack traces or operation chrome", () => {
    const logErrorWithStackTrace = vi.fn();
    const factory = createLoggerFactory();
    factory.setErrorLogger({ logErrorWithStackTrace } as never);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    factory
      .create()
      .logException(new ValidationError('Invalid --since duration "bogus".'), "models");

    expect(logErrorWithStackTrace).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalledWith(
      expect.stringContaining("Error during models")
    );
    consoleError.mockRestore();
  });

  it("renders user errors via errorWithStack without persisting a stack trace", () => {
    const logErrorFn = vi.fn();
    const factory = createLoggerFactory();
    factory.setErrorLogger({ logError: logErrorFn } as never);

    factory.create().errorWithStack(new ValidationError("Missing API key."));

    expect(logError).toHaveBeenCalledWith("Missing API key.");
    expect(logErrorFn).not.toHaveBeenCalled();
  });

  it("still logs stack traces for system errors", () => {
    const logErrorWithStackTrace = vi.fn();
    const factory = createLoggerFactory();
    factory.setErrorLogger({ logErrorWithStackTrace } as never);

    factory.create().logException(new Error("socket hang up"), "models");

    expect(logError).toHaveBeenCalledWith("Error during models: socket hang up");
    expect(logErrorWithStackTrace).toHaveBeenCalled();
  });

  it("does not log exceptions for OperationCancelledError by name", () => {
    const logger = createLoggerFactory().create();
    const error = new Error("Operation cancelled.");
    error.name = "OperationCancelledError";

    logger.logException(error, "login command");

    expect(logError).not.toHaveBeenCalled();
    expect(logMessage).not.toHaveBeenCalled();
  });
});
