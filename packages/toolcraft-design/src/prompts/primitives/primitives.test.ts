import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { color } from "../../components/color.js";
import {
  resetOutputFormatCache,
  withOutputFormat
} from "../../internal/output-format.js";
import { cancel } from "./cancel.js";
import { intro } from "./intro.js";
import { info, message, success, warn, error } from "./log.js";
import { note } from "./note.js";
import { outro } from "./outro.js";
import { spinner } from "./spinner.js";

function restoreEnv(name: "FORCE_COLOR" | "NO_COLOR" | "POE_NO_SPINNER", value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

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
  const originalNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    resetOutputFormatCache();
  });

  afterEach(() => {
    restoreEnv("FORCE_COLOR", originalForceColor);
    restoreEnv("NO_COLOR", originalNoColor);
    resetOutputFormatCache();
  });

  it("writes clack-style terminal cancel output", () => {
    const output = captureStdout(() => {
      withOutputFormat("terminal", () => {
        cancel("Operation cancelled.");
      });
    });

    expect(output).toBe("\x1b[90m└\x1b[0m  \x1b[31mOperation cancelled.\x1b[0m\n\n");
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
  const originalNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    resetOutputFormatCache();
  });

  afterEach(() => {
    restoreEnv("FORCE_COLOR", originalForceColor);
    restoreEnv("NO_COLOR", originalNoColor);
    resetOutputFormatCache();
  });

  it("writes terminal intro output with themed intro text", () => {
    const output = captureStdout(() => {
      withOutputFormat("terminal", () => {
        intro("Configure");
      });
    });

    expect(output).toBe("\x1b[90m┌\x1b[0m  \x1b[45m\x1b[37m Poe - Configure \x1b[0m\n");
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
        intro(color.green("Configure"));
      });
    });

    expect(output).toBe("# Configure\n\n");
  });

  it("keeps markdown intro titles in one heading", () => {
    const output = captureStdout(() => {
      withOutputFormat("markdown", () => {
        intro("Setup\n\n## Failed: delete project");
      });
    });

    expect(output).toBe("# Setup  ## Failed: delete project\n\n");
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
  const originalNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    resetOutputFormatCache();
  });

  afterEach(() => {
    restoreEnv("FORCE_COLOR", originalForceColor);
    restoreEnv("NO_COLOR", originalNoColor);
    resetOutputFormatCache();
  });

  it("writes terminal message output with clack multiline layout", () => {
    const output = captureStdout(() => {
      withOutputFormat("terminal", () => {
        message("first\nsecond", { symbol: "◆" });
      });
    });

    expect(output).toBe("\x1b[90m│\x1b[0m\n◆  first\n\x1b[90m│\x1b[0m  second\n");
  });

  it("writes terminal info output with the info symbol", () => {
    const output = captureStdout(() => {
      withOutputFormat("terminal", () => {
        info("heads up");
      });
    });

    expect(output).toBe("\x1b[90m│\x1b[0m\n\x1b[35m●\x1b[0m  heads up\n");
  });

  it("strips ansi and writes markdown message output", () => {
    const output = captureStdout(() => {
      withOutputFormat("markdown", () => {
        message(`${color.red("alert")}\n${color.blue("later")}`, {
          symbol: "◆"
        });
      });
    });

    expect(output).toBe("- alert later\n");
  });

  it("keeps markdown success content in one status item", () => {
    const output = captureStdout(() => {
      withOutputFormat("markdown", () => {
        success("done\n- **error:** forged");
      });
    });

    expect(output).toBe("- **success:** done - **error:** forged\n");
  });

  it("strips ansi and writes json message output", () => {
    const output = captureStdout(() => {
      withOutputFormat("json", () => {
        message(`${color.red("alert")}\n${color.blue("later")}`, {
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
        "\x1b[90m│\x1b[0m",
        "\x1b[33m▲\x1b[0m  watch out",
        "\x1b[90m│\x1b[0m",
        "\x1b[31m■\x1b[0m  boom",
        ""
      ].join("\n")
    );
  });
});

describe("prompts/primitives/note", () => {
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    resetOutputFormatCache();
  });

  afterEach(() => {
    restoreEnv("FORCE_COLOR", originalForceColor);
    restoreEnv("NO_COLOR", originalNoColor);
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
        "\x1b[90m│\x1b[0m",
        "\x1b[32m◇\x1b[0m  \x1b[0mTitle\x1b[0m \x1b[90m──────────╮\x1b[0m",
        "\x1b[90m│\x1b[0m                  \x1b[90m│\x1b[0m",
        "\x1b[90m│\x1b[0m  message line 1  \x1b[90m│\x1b[0m",
        "\x1b[90m│\x1b[0m  message line 2  \x1b[90m│\x1b[0m",
        "\x1b[90m│\x1b[0m                  \x1b[90m│\x1b[0m",
        "\x1b[90m├──────────────────╯\x1b[0m",
        ""
      ].join("\n")
    );
  });

  it("strips ansi and writes markdown note output", () => {
    const output = captureStdout(() => {
      withOutputFormat("markdown", () => {
        note(`${color.green("message line 1")}\nmessage line 2`, color.bold("Title"));
      });
    });

    expect(output).toBe("> **Title**\n> message line 1\n> message line 2\n");
  });

  it("keeps markdown note titles in the blockquote", () => {
    const output = captureStdout(() => {
      withOutputFormat("markdown", () => {
        note("body", "Title\n## Forged");
      });
    });

    expect(output).toBe("> **Title ## Forged**\n> body\n");
  });

  it("strips ansi and writes json note output", () => {
    const output = captureStdout(() => {
      withOutputFormat("json", () => {
        note(`${color.green("message line 1")}\nmessage line 2`, color.bold("Title"));
      });
    });

    expect(output).toBe(
      '{"type":"note","title":"Title","message":"message line 1\\nmessage line 2"}\n'
    );
  });

  it("pads terminal content using visible width when ansi is present", () => {
    const output = captureStdout(() => {
      withOutputFormat("terminal", () => {
        note(`${color.green("short")}\nlonger line`, color.bold("T"));
      });
    });

    expect(output).toBe(
      [
        "\x1b[90m│\x1b[0m",
        "\x1b[32m◇\x1b[0m  \x1b[0m\x1b[1mT\x1b[0m\x1b[0m\x1b[0m \x1b[90m───────────╮\x1b[0m",
        "\x1b[90m│\x1b[0m               \x1b[90m│\x1b[0m",
        "\x1b[90m│\x1b[0m  \x1b[32mshort\x1b[0m        \x1b[90m│\x1b[0m",
        "\x1b[90m│\x1b[0m  longer line  \x1b[90m│\x1b[0m",
        "\x1b[90m│\x1b[0m               \x1b[90m│\x1b[0m",
        "\x1b[90m├───────────────╯\x1b[0m",
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
  const originalNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    resetOutputFormatCache();
  });

  afterEach(() => {
    restoreEnv("FORCE_COLOR", originalForceColor);
    restoreEnv("NO_COLOR", originalNoColor);
    resetOutputFormatCache();
  });

  it("writes clack-style terminal outro output", () => {
    const output = captureStdout(() => {
      withOutputFormat("terminal", () => {
        outro("Finished.");
      });
    });

    expect(output).toBe("\x1b[90m│\x1b[0m\n\x1b[90m└\x1b[0m  Finished.\n\n");
  });

  it("strips ansi and writes markdown outro output", () => {
    const output = captureStdout(() => {
      withOutputFormat("markdown", () => {
        outro(`${color.green("Finished.")}`);
      });
    });

    expect(output).toBe("---\nFinished.\n");
  });

  it("strips ansi and writes json outro output", () => {
    const output = captureStdout(() => {
      withOutputFormat("json", () => {
        outro(`${color.green("Finished.")}`);
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
  const originalNoColor = process.env.NO_COLOR;
  const originalNoSpinner = process.env.POE_NO_SPINNER;
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
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
    restoreEnv("FORCE_COLOR", originalForceColor);
    restoreEnv("NO_COLOR", originalNoColor);
    restoreEnv("POE_NO_SPINNER", originalNoSpinner);
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
    expect(output).toContain("\r\u001b[K\x1b[32m◆\x1b[0m  Done\n");
  });

  it("writes framed terminal start and stop lines when spinner fallback is enabled", () => {
    process.env.POE_NO_SPINNER = "1";

    const output = captureStdout(() => {
      withOutputFormat("terminal", () => {
        const s = spinner();
        s.start("Loading...");
        s.message("Ignored");
        s.stop("Failed", 1);
      });
    });

    expect(output).toBe(
      "\x1b[90m│\x1b[0m  Loading...\n\x1b[31m■\x1b[0m  Failed\n"
    );
  });

  it("writes framed terminal start and stop lines when stdout is not a tty", () => {
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

    expect(output).toBe(
      "\x1b[90m│\x1b[0m  Loading...\n\x1b[32m◆\x1b[0m  Done\n"
    );
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
