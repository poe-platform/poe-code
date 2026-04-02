import chalk from "chalk";
import { resolveOutputFormat } from "../internal/output-format.js";
import { getTheme } from "../internal/theme-detect.js";

export const symbols = {
  get info(): string {
    const format = resolveOutputFormat();
    if (format === "json") return "info";
    if (format === "markdown") return "(i)";
    return chalk.magenta("●");
  },
  get success(): string {
    const format = resolveOutputFormat();
    if (format === "json") return "success";
    if (format === "markdown") return "[ok]";
    return chalk.magenta("◆");
  },
  get resolved(): string {
    const format = resolveOutputFormat();
    if (format === "json") return "resolved";
    if (format === "markdown") return ">";
    return getTheme().resolvedSymbol;
  },
  get errorResolved(): string {
    const format = resolveOutputFormat();
    if (format === "json") return "error";
    if (format === "markdown") return "[!]";
    return getTheme().errorSymbol;
  },
  get bar(): string {
    const format = resolveOutputFormat();
    if (format === "json") return "";
    if (format === "markdown") return "|";
    return "│";
  },
  cornerTopRight: "╮",
  cornerBottomRight: "╯",
  get warning(): string {
    const format = resolveOutputFormat();
    if (format === "json") return "warning";
    if (format === "markdown") return "[!]";
    return "▲";
  },
  get active(): string {
    const format = resolveOutputFormat();
    if (format === "json") return "active";
    if (format === "markdown") return "[x]";
    return "◆";
  },
  get inactive(): string {
    const format = resolveOutputFormat();
    if (format === "json") return "inactive";
    if (format === "markdown") return "[ ]";
    return "○";
  }
} as const;
