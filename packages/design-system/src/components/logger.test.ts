import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetOutputFormatCache,
  withOutputFormat
} from "../internal/output-format.js";
import { createLogger } from "./logger.js";

function captureStdout(run: () => void): string {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write);

  try {
    run();
  } finally {
    spy.mockRestore();
  }

  return chunks.join("");
}

describe("components/logger", () => {
  const originalForceColor = process.env.FORCE_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    resetOutputFormatCache();
  });

  afterEach(() => {
    process.env.FORCE_COLOR = originalForceColor;
    resetOutputFormatCache();
  });

  it("renders markdown info output through the log primitive", () => {
    const logger = createLogger();

    const output = captureStdout(() => {
      withOutputFormat("markdown", () => {
        logger.info("Configuring...");
      });
    });

    expect(output).toBe("- **info:** Configuring...\n");
  });

  it("renders json warning output through the log primitive", () => {
    const logger = createLogger();

    const output = captureStdout(() => {
      withOutputFormat("json", () => {
        logger.warn("Watch out");
      });
    });

    expect(output).toBe('{"level":"warn","message":"Watch out"}\n');
  });
});
