import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import chalk from "chalk";
import {
  resetOutputFormatCache,
  withOutputFormat
} from "../../internal/output-format.js";
import { spinner } from "./spinner.js";

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

describe("prompts/primitives/spinner", () => {
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoSpinner = process.env.POE_NO_SPINNER;
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.FORCE_COLOR = "1";
    process.env.POE_NO_SPINNER = undefined;
    resetOutputFormatCache();
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
      configurable: true
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.FORCE_COLOR = originalForceColor;
    process.env.POE_NO_SPINNER = originalNoSpinner;
    resetOutputFormatCache();
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      writable: true,
      configurable: true
    });
  });

  it("animates terminal frames, updates the message, and stops with success output", async () => {
    const output = captureStdout(() => {
      withOutputFormat("terminal", () => {
        const s = spinner();
        s.start("Loading...");
        vi.advanceTimersByTime(16);
        s.message("Almost there");
        s.stop("Done");
      });
    });

    expect(output).toContain(`\r\u001b[K◒  Loading...`);
    expect(output).toContain(`\r\u001b[K◐  Loading...`);
    expect(output).toContain(`\r\u001b[K◐  Almost there`);
    expect(output).toContain(`\r\u001b[K${chalk.green("◆")}  Done\n`);
  });

  it("writes plain terminal start and stop lines when spinner fallback is enabled", () => {
    process.env.POE_NO_SPINNER = "1";

    const output = captureStdout(() => {
      withOutputFormat("terminal", () => {
        const s = spinner();
        s.start("Loading...");
        s.message("Ignored");
        s.stop("Failed", 1);
      });
    });

    expect(output).toBe(`Loading...\n${chalk.red("■")}  Failed\n`);
  });

  it("writes plain terminal start and stop lines when stdout is not a tty", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      writable: true,
      configurable: true
    });

    const output = captureStdout(() => {
      withOutputFormat("terminal", () => {
        const s = spinner();
        s.start("Loading...");
        s.stop("Done");
      });
    });

    expect(output).toBe(`Loading...\n${chalk.green("◆")}  Done\n`);
  });

  it("writes markdown start and stop output", () => {
    const output = captureStdout(() => {
      withOutputFormat("markdown", () => {
        const s = spinner();
        s.start("Loading...");
        s.message("Ignored");
        s.stop("Done");
      });
    });

    expect(output).toBe("- Loading......\n- Done\n");
  });

  it("writes json output only when stopped", () => {
    const output = captureStdout(() => {
      withOutputFormat("json", () => {
        const s = spinner();
        s.start("Loading...");
        s.message("Ignored");
        s.stop("Done");
      });
    });

    expect(output).toBe(
      `${JSON.stringify({ type: "spinner", state: "stopped", message: "Done" })}\n`
    );
  });
});
