import { getThemeConfig } from "../internal/theme-state.js";
import { brands } from "../tokens/brand.js";

export const promptTheme = {
  symbols: {
    initial: "◆",
    active: "◆",
    inactive: "○",
    success: "◇"
  },
  style: {
    get accentColor(): string {
      return brands[getThemeConfig().brand]!.primary;
    }
  }
} as const;
