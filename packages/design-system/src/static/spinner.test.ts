import { afterEach, beforeEach, describe, expect, it } from "vitest";
import chalk from "chalk";
import { resetOutputFormatCache, withOutputFormat } from "../internal/output-format.js";
import { renderSpinnerFrame, renderSpinnerStopped } from "./spinner.js";

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
