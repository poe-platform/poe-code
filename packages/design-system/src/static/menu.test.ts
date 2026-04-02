import { afterEach, beforeEach, describe, expect, it } from "vitest";
import chalk from "chalk";
import { resetOutputFormatCache, withOutputFormat } from "../internal/output-format.js";
import { renderMenu } from "./menu.js";

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
