import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import chalk from "chalk";
import {
  resetOutputFormatCache,
  withOutputFormat
} from "../../internal/output-format.js";
import { outro } from "./outro.js";

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

describe("prompts/primitives/outro", () => {
  const originalForceColor = process.env.FORCE_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    resetOutputFormatCache();
  });

  afterEach(() => {
    process.env.FORCE_COLOR = originalForceColor;
    resetOutputFormatCache();
  });

  it("writes clack-style terminal outro output", () => {
    const output = captureStdout(() => {
      withOutputFormat("terminal", () => {
        outro("Finished.");
      });
    });

    expect(output).toBe(`${chalk.gray("│")}\n${chalk.gray("└")}  Finished.\n\n`);
  });

  it("strips ansi and writes markdown outro output", () => {
    const output = captureStdout(() => {
      withOutputFormat("markdown", () => {
        outro(`${chalk.green("Finished.")}`);
      });
    });

    expect(output).toBe("---\nFinished.\n");
  });

  it("strips ansi and writes json outro output", () => {
    const output = captureStdout(() => {
      withOutputFormat("json", () => {
        outro(`${chalk.green("Finished.")}`);
      });
    });

    expect(output).toBe('{"type":"outro","message":"Finished."}\n');
  });

  it("preserves an empty markdown outro body", () => {
    const output = captureStdout(() => {
      withOutputFormat("markdown", () => {
        outro("");
      });
    });

    expect(output).toBe("---\n\n");
  });
});
