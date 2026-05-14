import { getTheme } from "../internal/theme-detect.js";
import { light } from "../tokens/colors.js";
import type { CellStyle } from "../dashboard/types.js";
import type { Tone } from "./state.js";

export interface ExplorerTheme {
  accent: (text: string) => string;
  muted: (text: string) => string;
  border: (text: string) => string;
  borderFocused: (text: string) => string;
  badge: (text: string, tone: Tone) => string;
  matchHighlight: (text: string) => string;
}

export interface ExplorerStyles {
  accent: CellStyle;
  muted: CellStyle;
  border: CellStyle;
  borderFocused: CellStyle;
  matchHighlight: CellStyle;
  tones: Record<Tone, CellStyle>;
}

export function getExplorerTheme(): ExplorerTheme {
  const palette = getTheme();

  return {
    accent: palette.accent,
    muted: palette.muted,
    border: palette.divider,
    borderFocused: palette.accent,
    badge: (text, tone) => tonePainter(tone)(` ${text} `),
    matchHighlight: (text) => palette.accent(`\u001b[4m${text}\u001b[24m`)
  };
}

export function getExplorerStyles(): ExplorerStyles {
  return getTheme() === light
    ? {
        accent: { fg: "#006699", bold: true },
        muted: { fg: "#666666" },
        border: { fg: "#666666" },
        borderFocused: { fg: "#006699", bold: true },
        matchHighlight: { fg: "#006699", bold: true, underline: true },
        tones: {
          success: { fg: "#008800" },
          warning: { fg: "#cc6600" },
          error: { fg: "#cc0000" },
          info: { fg: "#a200ff" },
          muted: { fg: "#666666" }
        }
      }
    : {
        accent: { fg: "cyan", bold: true },
        muted: { dim: true },
        border: { dim: true },
        borderFocused: { fg: "cyan", bold: true },
        matchHighlight: { fg: "cyan", bold: true, underline: true },
        tones: {
          success: { fg: "green" },
          warning: { fg: "yellow" },
          error: { fg: "red" },
          info: { fg: "magenta" },
          muted: { dim: true }
        }
      };
}

function tonePainter(tone: Tone): (text: string) => string {
  const palette = getTheme();

  if (tone === "success") {
    return palette.success;
  }
  if (tone === "warning") {
    return palette.warning;
  }
  if (tone === "error") {
    return palette.error;
  }
  if (tone === "info") {
    return palette.info;
  }

  return palette.muted;
}
