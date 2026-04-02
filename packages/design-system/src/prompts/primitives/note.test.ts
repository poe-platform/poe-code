import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import chalk from "chalk";
import {
  resetOutputFormatCache,
  withOutputFormat
} from "../../internal/output-format.js";
import { note } from "./note.js";

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

  it("writes terminal note output with a boxed layout", () => {
    const output = captureStdout(() => {
      withOutputFormat("terminal", () => {
        note("message line 1\nmessage line 2", "Title");
      });
    });

    expect(output).toBe(
      [
        "╭  Title ──────────╮",
        "│  message line 1  │",
        "│  message line 2  │",
        "╰──────────────────╯",
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
        `╭  ${chalk.bold("T")} ───────────╮`,
        `│  ${chalk.green("short")}        │`,
        "│  longer line  │",
        "╰───────────────╯",
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
