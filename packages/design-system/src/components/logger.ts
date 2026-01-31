import { log } from "@clack/prompts";
import chalk from "chalk";
import { symbols } from "./symbols.js";

export interface LoggerOutput {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  resolved(label: string, value: string): void;
  errorResolved(label: string, value: string): void;
  message(message: string, symbol?: string): void;
}

export function createLogger(emitter?: (message: string) => void): LoggerOutput {
  const emit = (
    level: "info" | "success" | "warn" | "error",
    message: string
  ): void => {
    if (emitter) {
      emitter(message);
      return;
    }
    if (level === "success") {
      log.message(message, { symbol: symbols.success });
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
    log.message(message, { symbol: symbols.info });
  };

  return {
    info(message: string): void {
      emit("info", message);
    },
    success(message: string): void {
      emit("success", message);
    },
    warn(message: string): void {
      emit("warn", message);
    },
    error(message: string): void {
      emit("error", message);
    },
    resolved(label: string, value: string): void {
      if (emitter) {
        emitter(`${label}: ${value}`);
        return;
      }
      log.message(`${label}\n   ${value}`, { symbol: symbols.resolved });
    },
    errorResolved(label: string, value: string): void {
      if (emitter) {
        emitter(`${label}: ${value}`);
        return;
      }
      log.message(`${label}\n   ${value}`, { symbol: symbols.errorResolved });
    },
    message(message: string, symbol?: string): void {
      if (emitter) {
        emitter(message);
        return;
      }
      log.message(message, { symbol: symbol ?? chalk.gray("│") });
    }
  };
}

export const logger = createLogger();
