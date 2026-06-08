import { getTheme } from "../internal/theme-detect.js";
import type { Tone } from "./state.js";

type CellStyle = {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
};

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
  const theme = getTheme();
  return {
    accent: theme.accent,
    muted: theme.muted,
    border: theme.muted,
    borderFocused: theme.accent,
    badge: (text, tone) => theme[tone](` ${text} `),
    matchHighlight: (text) => theme.accent(`\u001b[4m${text}\u001b[24m`)
  };
}

export function getExplorerStyles(): ExplorerStyles {
  const styles = getTheme().styles;
  return {
    accent: styles.accent,
    muted: styles.muted,
    border: styles.muted,
    borderFocused: styles.accent,
    matchHighlight: { ...styles.accent, underline: true },
    tones: {
      success: styles.success,
      warning: styles.warning,
      error: styles.error,
      info: styles.info,
      muted: styles.muted
    }
  };
}
