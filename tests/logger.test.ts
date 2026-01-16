import { describe, it, expect, vi, beforeEach } from "vitest";
import chalk from "chalk";

const logMessage = vi.hoisted(() => vi.fn());
const logWarn = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
const noteFn = vi.hoisted(() => vi.fn());
const introFn = vi.hoisted(() => vi.fn());
const outroFn = vi.hoisted(() => vi.fn());

vi.mock("@clack/prompts", () => ({
  log: {
    message: logMessage,
    warn: logWarn,
    error: logError
  },
  note: noteFn,
  intro: introFn,
  outro: outroFn
}));

import { createLoggerFactory } from "../src/cli/logger.js";

describe("createLoggerFactory", () => {
  beforeEach(() => {
    logMessage.mockClear();
    logWarn.mockClear();
    logError.mockClear();
    noteFn.mockClear();
    introFn.mockClear();
    outroFn.mockClear();
  });

  it("uses purple symbols for info and success without a custom emitter", () => {
    const logger = createLoggerFactory().create();

    logger.info("Hello");
    logger.success("Done");

    expect(logMessage).toHaveBeenCalledWith("Hello", {
      symbol: chalk.magenta("●")
    });
    expect(logMessage).toHaveBeenCalledWith("Done", {
      symbol: chalk.magenta("◆")
    });
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

    expect(introFn).toHaveBeenCalledWith("[STYLED:configure claude-code]");
  });

  it("renders resolved option with label and value", () => {
    const logger = createLoggerFactory().create();

    logger.resolved("Model", "Claude-Opus-4.5");

    expect(logMessage).toHaveBeenCalledWith("Model\n   Claude-Opus-4.5", {
      symbol: chalk.magenta("◇")
    });
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
});
