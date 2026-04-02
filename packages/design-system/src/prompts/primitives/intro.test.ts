import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import chalk from "chalk";
import {
  resetOutputFormatCache,
  withOutputFormat
} from "../../internal/output-format.js";
import { text } from "../../components/text.js";
import { intro } from "./intro.js";

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

describe("prompts/primitives/intro", () => {
  const originalForceColor = process.env.FORCE_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    resetOutputFormatCache();
  });

  afterEach(() => {
    process.env.FORCE_COLOR = originalForceColor;
    resetOutputFormatCache();
  });

  it("writes terminal intro output with themed intro text", () => {
    const output = captureStdout(() => {
      withOutputFormat("terminal", () => {
        intro("Configure");
      });
    });

    expect(output).toBe(`┌  ${text.intro("Configure")}\n`);
  });

  it("writes markdown intro output", () => {
    const output = captureStdout(() => {
      withOutputFormat("markdown", () => {
        intro("Configure");
      });
    });

    expect(output).toBe("# Configure\n\n");
  });

  it("strips ansi in markdown output", () => {
    const output = captureStdout(() => {
      withOutputFormat("markdown", () => {
        intro(chalk.green("Configure"));
      });
    });

    expect(output).toBe("# Configure\n\n");
  });

  it("is silent for json output", () => {
    const output = captureStdout(() => {
      withOutputFormat("json", () => {
        intro("Configure");
      });
    });

    expect(output).toBe("");
  });
});
