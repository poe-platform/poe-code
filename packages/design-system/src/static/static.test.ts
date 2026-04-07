import { afterEach, beforeEach, describe, expect, it } from "vitest";
import chalk from "chalk";
import { resetOutputFormatCache, withOutputFormat } from "../internal/output-format.js";
import { renderMenu } from "./menu.js";
import { renderSpinnerFrame, renderSpinnerStopped } from "./spinner.js";

describe("static/menu", () => {
  const originalForceColor = process.env.FORCE_COLOR;
  const options = [
    { value: "claude", label: "Claude Code", hint: "Recommended" },
    { value: "codex", label: "Codex CLI" }
  ];

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    resetOutputFormatCache();
  });

  afterEach(() => {
    process.env.FORCE_COLOR = originalForceColor;
    resetOutputFormatCache();
  });

  it("renders terminal menu unchanged", () => {
    const output = withOutputFormat("terminal", () =>
      renderMenu({
        message: "Pick an agent:",
        options,
        selectedIndex: 0
      })
    );

    expect(output).toContain(`${chalk.cyan("◆")}  Pick an agent:`);
    expect(output).toContain(`${chalk.gray("│")}  ${chalk.cyan("◆")} `);
    expect(output).toContain(`${chalk.gray("│")}  ${chalk.gray("○")} Codex CLI`);
  });

  it("renders markdown menu output", () => {
    const output = withOutputFormat("markdown", () =>
      renderMenu({
        message: "Pick an agent:",
        options,
        selectedIndex: 0
      })
    );

    expect(output).toBe(["**Pick an agent:**", "- [x] Claude Code", "- [ ] Codex CLI"].join("\n"));
  });

  it("renders json menu output", () => {
    const output = withOutputFormat("json", () =>
      renderMenu({
        message: "Pick an agent:",
        options,
        selectedIndex: 1
      })
    );

    expect(output).toBe(
      JSON.stringify({
        type: "menu",
        message: "Pick an agent:",
        options,
        selected: 1
      })
    );
  });
});

describe("static/spinner", () => {
  const originalForceColor = process.env.FORCE_COLOR;

  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    resetOutputFormatCache();
  });

  afterEach(() => {
    process.env.FORCE_COLOR = originalForceColor;
    resetOutputFormatCache();
  });

  it("renders terminal spinner frame and stopped output unchanged", () => {
    const frame = withOutputFormat("terminal", () =>
      renderSpinnerFrame({ frame: 1, message: "Loading", timer: "1s" })
    );
    const stopped = withOutputFormat("terminal", () =>
      renderSpinnerStopped({
        message: "Done",
        timer: "2s",
        subtext: "Finished"
      })
    );

    expect(frame).toBe(`${chalk.magenta("◐")}  Loading${chalk.dim(" [1s]")}\n${chalk.gray("│")}`);
    expect(stopped).toBe(
      `${chalk.green("◆")}  Done${chalk.dim(" [2s]")}\n${chalk.gray("│")}     ${chalk.dim("Finished")}`
    );
  });

  it("renders markdown spinner output", () => {
    const frame = withOutputFormat("markdown", () =>
      renderSpinnerFrame({ message: "Loading", timer: "1s" })
    );
    const stopped = withOutputFormat("markdown", () =>
      renderSpinnerStopped({ message: "Done", timer: "2s", subtext: "Ignored" })
    );

    expect(frame).toBe("- Loading [1s]...\n");
    expect(stopped).toBe("- Done [2s]\n");
  });

  it("renders json spinner output", () => {
    const frame = withOutputFormat("json", () =>
      renderSpinnerFrame({ message: "Loading", timer: "1s" })
    );
    const stopped = withOutputFormat("json", () =>
      renderSpinnerStopped({ message: "Done", timer: "2s" })
    );

    expect(frame).toBe(
      `${JSON.stringify({
        type: "spinner",
        state: "running",
        message: "Loading",
        timer: "1s"
      })}\n`
    );
    expect(stopped).toBe(
      `${JSON.stringify({
        type: "spinner",
        state: "stopped",
        message: "Done",
        timer: "2s"
      })}\n`
    );
  });
});
