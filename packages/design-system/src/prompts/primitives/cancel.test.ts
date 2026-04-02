import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import chalk from "chalk";
import {
  resetOutputFormatCache,
  withOutputFormat
} from "../../internal/output-format.js";
import { cancel } from "./cancel.js";

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

describe("prompts/primitives/cancel", () => {
  const originalForceColor = process.env.FORCE_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    resetOutputFormatCache();
  });

  afterEach(() => {
    process.env.FORCE_COLOR = originalForceColor;
    resetOutputFormatCache();
  });

  it("writes clack-style terminal cancel output", () => {
    const output = captureStdout(() => {
      withOutputFormat("terminal", () => {
        cancel("Operation cancelled.");
      });
    });

    expect(output).toBe(
      `${chalk.gray("└")}  ${chalk.red("Operation cancelled.")}\n\n`
    );
  });

  it("is silent for markdown output", () => {
    const output = captureStdout(() => {
      withOutputFormat("markdown", () => {
        cancel("Operation cancelled.");
      });
    });

    expect(output).toBe("");
  });

  it("is silent for json output", () => {
    const output = captureStdout(() => {
      withOutputFormat("json", () => {
        cancel("Operation cancelled.");
      });
    });

    expect(output).toBe("");
  });
});
