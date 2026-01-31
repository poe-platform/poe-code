import { brand } from "../tokens/colors.js";

export const promptTheme = {
  symbols: {
    initial: "◆",
    active: "◆",
    inactive: "○",
    success: "◇"
  },
  style: {
    accentColor: brand
  }
} as const;
