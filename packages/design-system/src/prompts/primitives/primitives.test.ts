import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import chalk from "chalk";
import {
  resetOutputFormatCache,
  withOutputFormat
} from "../../internal/output-format.js";
import { cancel } from "./cancel.js";
import { intro } from "./intro.js";
import { info, message, warn, error } from "./log.js";
import { note } from "./note.js";
import { outro } from "./outro.js";
import { spinner } from "./spinner.js";
import { text } from "../../components/text.js";

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

    expect(output).toBe(`${chalk.gray("┌")}  ${text.intro("Configure")}\n`);
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

describe("prompts/primitives/note", () => {
  const originalForceColor = process.env.FORCE_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    resetOutputFormatCache();
  });

  afterEach(() => {
    process.env.FORCE_COLOR = originalForceColor;
    resetOutputFormatCache();
  });

  it("writes terminal note output with a clack-style boxed layout", () => {
    const output = captureStdout(() => {
      withOutputFormat("terminal", () => {
        note("message line 1\nmessage line 2", "Title");
      });
    });

    expect(output).toBe(
      [
        chalk.gray("│"),
        `${chalk.green("◇")}  ${chalk.reset("Title")} ${chalk.gray("──────────╮")}`,
        `${chalk.gray("│")}                  ${chalk.gray("│")}`,
        `${chalk.gray("│")}  message line 1  ${chalk.gray("│")}`,
        `${chalk.gray("│")}  message line 2  ${chalk.gray("│")}`,
        `${chalk.gray("│")}                  ${chalk.gray("│")}`,
        chalk.gray("├──────────────────╯"),
        ""
      ].join("\n")
    );
  });

  it("strips ansi and writes markdown note output", () => {
    const output = captureStdout(() => {
      withOutputFormat("markdown", () => {
        note(`${chalk.green("message line 1")}\nmessage line 2`, chalk.bold("Title"));
      });
    });

    expect(output).toBe("> **Title**\n> message line 1\n> message line 2\n");
  });

  it("strips ansi and writes json note output", () => {
    const output = captureStdout(() => {
      withOutputFormat("json", () => {
        note(`${chalk.green("message line 1")}\nmessage line 2`, chalk.bold("Title"));
      });
    });

    expect(output).toBe(
      '{"type":"note","title":"Title","message":"message line 1\\nmessage line 2"}\n'
    );
  });

  it("pads terminal content using visible width when ansi is present", () => {
    const output = captureStdout(() => {
      withOutputFormat("terminal", () => {
        note(`${chalk.green("short")}\nlonger line`, chalk.bold("T"));
      });
    });

    expect(output).toBe(
      [
        chalk.gray("│"),
        `${chalk.green("◇")}  ${chalk.reset(chalk.bold("T"))} ${chalk.gray("───────────╮")}`,
        `${chalk.gray("│")}               ${chalk.gray("│")}`,
        `${chalk.gray("│")}  ${chalk.green("short")}        ${chalk.gray("│")}`,
        `${chalk.gray("│")}  longer line  ${chalk.gray("│")}`,
        `${chalk.gray("│")}               ${chalk.gray("│")}`,
        chalk.gray("├───────────────╯"),
        ""
      ].join("\n")
    );
  });

  it("writes a titleless markdown note as a plain blockquote", () => {
    const output = captureStdout(() => {
      withOutputFormat("markdown", () => {
        note("message line 1\n", undefined);
      });
    });

    expect(output).toBe("> message line 1\n> \n");
  });
});

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
