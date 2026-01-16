import { intro, log, note, outro } from "@clack/prompts";
import chalk from "chalk";
import type { LoggerFn } from "./types.js";
import type { ErrorLogger, ErrorContext } from "./error-logger.js";

export interface LoggerContext {
  dryRun?: boolean;
  verbose?: boolean;
  scope?: string;
}

export interface ScopedLogger {
  readonly context: Required<Pick<LoggerContext, "dryRun" | "verbose">> &
    Pick<LoggerContext, "scope">;
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  errorWithStack(error: Error, context?: ErrorContext): void;
  logException(error: Error, operation: string, context?: ErrorContext): void;
  dryRun(message: string): void;
  verbose(message: string): void;
  intro(title: string): void;
  resolved(label: string, value: string): void;
  nextSteps(steps: string[]): void;
  feedback(label: string, url: string): void;
  child(context: Partial<LoggerContext>): ScopedLogger;
}

export interface LoggerFactory {
  base: LoggerFn;
  errorLogger?: ErrorLogger;
  create(context?: LoggerContext): ScopedLogger;
  setErrorLogger(errorLogger: ErrorLogger): void;
}

export interface LoggerTheme {
  intro?: (text: string) => string;
  resolvedSymbol?: string;
}

function wrapText(text: string, maxWidth: number): string {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length === 0) {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= maxWidth) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }
  return lines.join("\n");
}

export function createLoggerFactory(
  emitter?: LoggerFn,
  theme?: LoggerTheme
): LoggerFactory {
  let errorLogger: ErrorLogger | undefined;

  const infoSymbol = chalk.magenta("●");
  const successSymbol = chalk.magenta("◆");

  const emit = (
    level: "info" | "success" | "warn" | "error",
    message: string
  ): void => {
    if (emitter) {
      emitter(message);
      return;
    }
    if (level === "success") {
      log.message(message, { symbol: successSymbol });
      return;
    }
    if (level === "warn") {
      log.warn(message);
      return;
    }
    if (level === "error") {
      log.error(message);
      return;
    }
    log.message(message, { symbol: infoSymbol });
  };

  const create = (context: LoggerContext = {}): ScopedLogger => {
    const dryRun = context.dryRun ?? false;
    const verbose = context.verbose ?? false;
    const scope = context.scope;
    const formatMessage = (message: string): string =>
      scope && verbose ? `[${scope}] ${message}` : message;

    const scoped: ScopedLogger = {
      context: { dryRun, verbose, scope: context.scope },
      info(message) {
        emit("info", formatMessage(message));
      },
      success(message) {
        emit("success", message);
      },
      warn(message) {
        emit("warn", formatMessage(message));
      },
      error(message) {
        emit("error", formatMessage(message));
      },
      errorWithStack(error, errorContext) {
        emit("error", formatMessage(error.message));

        if (errorLogger) {
          const fullContext: ErrorContext = {
            ...errorContext,
            scope,
            component: scope
          };
          errorLogger.logError(error, fullContext);
        } else {
          // Fallback if error logger not available
          console.error("Stack trace:", error.stack);
        }
      },
      logException(error, operation, errorContext) {
        emit(
          "error",
          formatMessage(`Error during ${operation}: ${error.message}`)
        );

        if (errorLogger) {
          const fullContext: ErrorContext = {
            ...errorContext,
            operation,
            scope,
            component: scope
          };
          errorLogger.logErrorWithStackTrace(error, operation, fullContext);
        } else {
          // Fallback if error logger not available
          console.error("Stack trace:", error.stack);
        }
      },
      dryRun(message) {
        emit("info", formatMessage(message));
      },
      verbose(message) {
        if (!verbose) {
          return;
        }
        if (emitter) {
          emitter(formatMessage(message));
          return;
        }
        log.message(formatMessage(message), { symbol: chalk.gray("│") });
      },
      intro(title) {
        if (emitter) {
          emitter(title);
          return;
        }
        const formatted = theme?.intro ? theme.intro(title) : title;
        intro(formatted);
      },
      resolved(label, value) {
        if (emitter) {
          emitter(`${label}: ${value}`);
          return;
        }
        const symbol = theme?.resolvedSymbol ?? chalk.magenta("◇");
        log.message(`${label}\n   ${value}`, { symbol });
      },
      nextSteps(steps) {
        if (steps.length === 0) {
          return;
        }
        if (emitter) {
          emitter(steps.join("\n"));
          return;
        }
        const maxWidth = Math.min(process.stdout.columns || 80, 80) - 6;
        const wrapped = steps.map((step) => wrapText(step, maxWidth)).join("\n");
        note(wrapped, "Next steps.");
      },
      feedback(label, url) {
        if (emitter) {
          emitter(`${label} ${url}`);
          return;
        }
        outro(chalk.dim(`${label} ${url}`));
      },
      child(next) {
        return create({
          dryRun: next.dryRun ?? dryRun,
          verbose: next.verbose ?? verbose,
          scope: next.scope ?? scope
        });
      }
    };

    return scoped;
  };

  return {
    base: emitter ?? ((message) => log.message(message, { symbol: infoSymbol })),
    errorLogger,
    create,
    setErrorLogger(logger: ErrorLogger) {
      errorLogger = logger;
    }
  };
}
