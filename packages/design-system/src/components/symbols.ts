import chalk from "chalk";
import { getTheme } from "../internal/theme-detect.js";

export const symbols = {
  get info(): string {
    return chalk.magenta("●");
  },
  get success(): string {
    return chalk.magenta("◆");
  },
  get resolved(): string {
    const theme = getTheme();
    return theme.resolvedSymbol;
  },
  get errorResolved(): string {
    const theme = getTheme();
    return theme.errorSymbol;
  },
  bar: "│",
  cornerTopRight: "╮",
  cornerBottomRight: "╯",
  warning: "▲",
  active: "◆",
  inactive: "○"
} as const;
