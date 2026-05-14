import type { Tone } from "./state.js";

type CellStyle = {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
};

type ThemeName = "dark" | "light";

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
  return {
    accent: accent,
    muted: muted,
    border: muted,
    borderFocused: accent,
    badge: (text, tone) => tonePainter(tone)(` ${text} `),
    matchHighlight: (text) => accent(`\u001b[4m${text}\u001b[24m`)
  };
}

export function getExplorerStyles(): ExplorerStyles {
  return resolveThemeName() === "light"
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
  const light = resolveThemeName() === "light";

  if (tone === "success") {
    return light ? hex(0, 136, 0) : ansi(32);
  }
  if (tone === "warning") {
    return light ? hex(204, 102, 0) : ansi(33);
  }
  if (tone === "error") {
    return light ? hex(204, 0, 0) : ansi(31);
  }
  if (tone === "info") {
    return light ? hex(162, 0, 255) : ansi(35);
  }

  return muted;
}

function accent(text: string): string {
  return resolveThemeName() === "light" ? ansi(38, 2, 0, 102, 153, 1)(text) : ansi(36)(text);
}

function muted(text: string): string {
  return resolveThemeName() === "light" ? hex(102, 102, 102)(text) : ansi(2)(text);
}

function hex(red: number, green: number, blue: number): (text: string) => string {
  return ansi(38, 2, red, green, blue);
}

function ansi(...codes: number[]): (text: string) => string {
  return (text) => `\u001b[${codes.join(";")}m${text}\u001b[0m`;
}

function resolveThemeName(env: NodeJS.ProcessEnv = process.env): ThemeName {
  const raw = (env.POE_CODE_THEME ?? env.POE_THEME)?.toLowerCase();
  if (raw === "light" || raw === "dark") {
    return raw;
  }

  const apple = env.APPLE_INTERFACE_STYLE;
  if (typeof apple === "string") {
    return apple.toLowerCase() === "dark" ? "dark" : "light";
  }

  const vscodeKind = env.VSCODE_COLOR_THEME_KIND;
  if (typeof vscodeKind === "string") {
    const normalized = vscodeKind.toLowerCase();
    if (normalized.includes("light")) {
      return "light";
    }
    if (normalized.includes("dark")) {
      return "dark";
    }
  }

  const colorFGBG = env.COLORFGBG;
  if (typeof colorFGBG === "string") {
    const background = Number.parseInt(colorFGBG.split(";").at(-1) ?? "", 10);
    if (Number.isFinite(background)) {
      return background >= 8 ? "light" : "dark";
    }
  }

  return "dark";
}
