import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import chalk from "chalk";
import {
  resetOutputFormatCache,
  withOutputFormat
} from "../../internal/output-format.js";
import { info, message, warn, error } from "./log.js";

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

describe("prompts/primitives/log", () => {
  const originalForceColor = process.env.FORCE_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    resetOutputFormatCache();
  });

  afterEach(() => {
    process.env.FORCE_COLOR = originalForceColor;
    resetOutputFormatCache();
  });

  it("writes terminal message output with clack multiline layout", () => {
    const output = captureStdout(() => {
      withOutputFormat("terminal", () => {
        message("first\nsecond", { symbol: "◆" });
      });
    });

    expect(output).toBe(
      `${chalk.gray("│")}\n◆  first\n${chalk.gray("│")}  second\n`
    );
  });

  it("writes terminal info output with the info symbol", () => {
    const output = captureStdout(() => {
      withOutputFormat("terminal", () => {
        info("heads up");
      });
    });

    expect(output).toBe(
      `${chalk.gray("│")}\n${chalk.magenta("●")}  heads up\n`
    );
  });

  it("strips ansi and writes markdown message output", () => {
    const output = captureStdout(() => {
      withOutputFormat("markdown", () => {
        message(`${chalk.red("alert")}\n${chalk.blue("later")}`, {
          symbol: "◆"
        });
      });
    });

    expect(output).toBe("- alert\nlater\n");
  });

  it("strips ansi and writes json message output", () => {
    const output = captureStdout(() => {
      withOutputFormat("json", () => {
        message(`${chalk.red("alert")}\n${chalk.blue("later")}`, {
          symbol: "◆"
        });
      });
    });

    expect(output).toBe('{"level":"message","message":"alert\\nlater"}\n');
  });

  it("writes markdown warning output", () => {
    const output = captureStdout(() => {
      withOutputFormat("markdown", () => {
        warn("be careful");
      });
    });

    expect(output).toBe("- **warning:** be careful\n");
  });

  it("writes json error output", () => {
    const output = captureStdout(() => {
      withOutputFormat("json", () => {
        error("boom");
      });
    });

    expect(output).toBe('{"level":"error","message":"boom"}\n');
  });

  it("writes terminal warning and error output with clack symbols", () => {
    const output = captureStdout(() => {
      withOutputFormat("terminal", () => {
        warn("watch out");
        error("boom");
      });
    });

    expect(output).toBe(
      [
        chalk.gray("│"),
        `${chalk.yellow("▲")}  watch out`,
        chalk.gray("│"),
        `${chalk.red("■")}  boom`,
        ""
      ].join("\n")
    );
  });
});
