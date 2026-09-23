import {
  MermaidError,
  type MermaidLayoutOptions,
  type MermaidThemeMode,
  type MermaidThemeTokens
} from "./contracts.js";

export interface RgbaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const DEFAULT_UI_FONT_FAMILY =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const DEFAULT_MONO_FONT_FAMILY =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

export const lightThemeTokens: MermaidThemeTokens = Object.freeze({
  canvas: "#f8fafc",
  surface: "#ffffff",
  surfaceElevated: "#ffffff",
  surfaceAccent: "#eff6ff",
  text: "#0f172a",
  mutedText: "#475569",
  border: "#cbd5e1",
  borderStrong: "#64748b",
  edge: "#64748b",
  edgeLabelBackground: "#ffffff",
  edgeLabelBorder: "#e2e8f0",
  accent: "#2563eb",
  accentSurface: "#eff6ff",
  accentBorder: "#60a5fa",
  accentText: "#1e3a8a",
  groupSurface: "#f1f5f980",
  groupHeaderSurface: "#e2e8f080",
  groupBorder: "#cbd5e1",
  noteSurface: "#fefce8",
  noteBorder: "#facc15",
  noteText: "#713f12",
  activationSurface: "#dbeafe",
  shadowColor: "rgba(15, 23, 42, 0.06)",
  fontFamily: DEFAULT_UI_FONT_FAMILY,
  monospaceFontFamily: DEFAULT_MONO_FONT_FAMILY,
  fontSize: 13,
  secondaryFontSize: 11.5,
  lineHeight: 20,
  strokeWidth: 1.25,
  edgeStrokeWidth: 1.5,
  cornerRadius: 8,
  elbowRadius: 10,
  rankGap: 56,
  nodeGap: 32,
  padding: 32
});

export const darkThemeTokens: MermaidThemeTokens = Object.freeze({
  canvas: "#0b1120",
  surface: "#1e293b",
  surfaceElevated: "#263449",
  surfaceAccent: "#172554",
  text: "#f8fafc",
  mutedText: "#94a3b8",
  border: "#334155",
  borderStrong: "#64748b",
  edge: "#94a3b8",
  edgeLabelBackground: "#1e293b",
  edgeLabelBorder: "#334155",
  accent: "#60a5fa",
  accentSurface: "#172554",
  accentBorder: "#3b82f6",
  accentText: "#dbeafe",
  groupSurface: "#0f172a99",
  groupHeaderSurface: "#1e293b",
  groupBorder: "#334155",
  noteSurface: "#422006",
  noteBorder: "#ca8a04",
  noteText: "#fef08a",
  activationSurface: "#1e3a8a",
  shadowColor: "rgba(0, 0, 0, 0.35)",
  fontFamily: DEFAULT_UI_FONT_FAMILY,
  monospaceFontFamily: DEFAULT_MONO_FONT_FAMILY,
  fontSize: 13,
  secondaryFontSize: 11.5,
  lineHeight: 20,
  strokeWidth: 1.25,
  edgeStrokeWidth: 1.5,
  cornerRadius: 8,
  elbowRadius: 10,
  rankGap: 56,
  nodeGap: 32,
  padding: 32
});

const NAMED_COLORS: Readonly<Record<string, RgbaColor>> = Object.freeze({
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  white: { r: 255, g: 255, b: 255, a: 255 },
  black: { r: 0, g: 0, b: 0, a: 255 }
});

function parseHexDigit(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

function parseHexByte(str: string, offset: number): number {
  const hi = parseHexDigit(str[offset]!);
  const lo = parseHexDigit(str[offset + 1]!);
  if (hi < 0 || lo < 0) return -1;
  return (hi << 4) | lo;
}

export function parseCssColor(raw: string): RgbaColor {
  if (typeof raw !== "string") {
    throw new MermaidError("E_CONFIG", "Color value must be a string");
  }
  const value = raw.trim().toLowerCase();
  const named = NAMED_COLORS[value];
  if (named) return named;

  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseHexDigit(hex[0]!);
      const g = parseHexDigit(hex[1]!);
      const b = parseHexDigit(hex[2]!);
      const a = hex.length === 4 ? parseHexDigit(hex[3]!) : 15;
      if (r < 0 || g < 0 || b < 0 || a < 0) {
        throw new MermaidError("E_CONFIG", `Invalid hex color '${raw}'`);
      }
      return { r: r * 17, g: g * 17, b: b * 17, a: a * 17 };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseHexByte(hex, 0);
      const g = parseHexByte(hex, 2);
      const b = parseHexByte(hex, 4);
      const a = hex.length === 8 ? parseHexByte(hex, 6) : 255;
      if (r < 0 || g < 0 || b < 0 || a < 0) {
        throw new MermaidError("E_CONFIG", `Invalid hex color '${raw}'`);
      }
      return { r, g, b, a };
    }
    throw new MermaidError("E_CONFIG", `Invalid hex color '${raw}'`);
  }

  const isRgba = value.startsWith("rgba(") && value.endsWith(")");
  const isRgb = value.startsWith("rgb(") && value.endsWith(")");
  if (isRgba || isRgb) {
    const inner = value.slice(isRgba ? 5 : 4, -1);
    const parts = inner.split(",").map((part) => part.trim());
    if ((isRgb && parts.length !== 3) || (isRgba && parts.length !== 4)) {
      throw new MermaidError("E_CONFIG", `Invalid RGB/RGBA color '${raw}'`);
    }
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    const aFloat = isRgba ? Number(parts[3]) : 1;
    if (
      !Number.isFinite(r) ||
      !Number.isFinite(g) ||
      !Number.isFinite(b) ||
      !Number.isFinite(aFloat) ||
      r < 0 ||
      r > 255 ||
      g < 0 ||
      g > 255 ||
      b < 0 ||
      b > 255 ||
      aFloat < 0 ||
      aFloat > 1
    ) {
      throw new MermaidError("E_CONFIG", `Out-of-range RGB/RGBA color '${raw}'`);
    }
    return {
      r: Math.round(r),
      g: Math.round(g),
      b: Math.round(b),
      a: Math.round(aFloat * 255)
    };
  }

  throw new MermaidError("E_CONFIG", `Unsupported color format '${raw}'`);
}

const COLOR_TOKEN_KEYS: readonly (keyof MermaidThemeTokens)[] = [
  "canvas",
  "surface",
  "surfaceElevated",
  "surfaceAccent",
  "text",
  "mutedText",
  "border",
  "borderStrong",
  "edge",
  "edgeLabelBackground",
  "edgeLabelBorder",
  "accent",
  "accentSurface",
  "accentBorder",
  "accentText",
  "groupSurface",
  "groupHeaderSurface",
  "groupBorder",
  "noteSurface",
  "noteBorder",
  "noteText",
  "activationSurface",
  "shadowColor"
];

const NUMERIC_TOKEN_KEYS: readonly (keyof MermaidThemeTokens)[] = [
  "fontSize",
  "secondaryFontSize",
  "lineHeight",
  "strokeWidth",
  "edgeStrokeWidth",
  "cornerRadius",
  "elbowRadius",
  "rankGap",
  "nodeGap",
  "padding"
];

function validateAndMergeTokens(
  base: MermaidThemeTokens,
  overrides?: Partial<MermaidThemeTokens>
): MermaidThemeTokens {
  if (!overrides) return base;
  const merged: Record<keyof MermaidThemeTokens, string | number> = { ...base };
  for (const key of Object.keys(overrides) as (keyof MermaidThemeTokens)[]) {
    if (!(key in base)) {
      throw new MermaidError("E_CONFIG", `Unknown theme token '${String(key)}'`);
    }
    const val = overrides[key];
    if (val === undefined) continue;
    if (COLOR_TOKEN_KEYS.includes(key)) {
      if (typeof val !== "string") {
        throw new MermaidError("E_CONFIG", `Theme token '${key}' must be a valid color string`);
      }
      parseCssColor(val);
      merged[key] = val;
    } else if (NUMERIC_TOKEN_KEYS.includes(key)) {
      if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) {
        throw new MermaidError("E_CONFIG", `Theme token '${key}' must be a positive finite number`);
      }
      merged[key] = val;
    } else if (key === "fontFamily" || key === "monospaceFontFamily") {
      if (typeof val !== "string" || val.trim().length === 0) {
        throw new MermaidError("E_CONFIG", `Theme token '${key}' must be a non-empty string`);
      }
      merged[key] = val;
    }
  }
  return Object.freeze(merged as unknown as MermaidThemeTokens);
}

export interface ResolvedMermaidTheme {
  readonly mode: MermaidThemeMode;
  readonly tokens: MermaidThemeTokens;
  readonly backgroundColor: string;
}

export function resolveMermaidTheme(options?: MermaidLayoutOptions): ResolvedMermaidTheme {
  let mode: MermaidThemeMode = "light";
  const settingsMode = options?.settings?.theme?.mode;
  if (settingsMode !== undefined) {
    if (settingsMode !== "light" && settingsMode !== "dark") {
      throw new MermaidError("E_CONFIG", `Unsupported theme mode '${String(settingsMode)}'`);
    }
    mode = settingsMode;
  }

  let inlineOverrides: Partial<MermaidThemeTokens> | undefined;
  if (typeof options?.theme === "string") {
    if (options.theme !== "light" && options.theme !== "dark") {
      throw new MermaidError(
        "E_CONFIG",
        `Unsupported theme '${options.theme}'. Expected 'light' or 'dark'.`
      );
    }
    mode = options.theme;
  } else if (options?.theme && typeof options.theme === "object") {
    inlineOverrides = options.theme;
  }

  const base = mode === "dark" ? darkThemeTokens : lightThemeTokens;
  const hostOverrides =
    mode === "dark" ? options?.settings?.theme?.dark : options?.settings?.theme?.light;

  // Merge inline options first, then host palette overrides so host overrides remain authoritative.
  let tokens = validateAndMergeTokens(base, inlineOverrides);
  tokens = validateAndMergeTokens(tokens, hostOverrides);

  if (
    options?.rankGap !== undefined ||
    options?.nodeGap !== undefined ||
    options?.padding !== undefined
  ) {
    tokens = validateAndMergeTokens(tokens, {
      ...(options.rankGap !== undefined ? { rankGap: options.rankGap } : {}),
      ...(options.nodeGap !== undefined ? { nodeGap: options.nodeGap } : {}),
      ...(options.padding !== undefined ? { padding: options.padding } : {})
    });
  }

  let backgroundColor = tokens.canvas;
  if (options?.backgroundColor !== undefined) {
    parseCssColor(options.backgroundColor);
    backgroundColor = options.backgroundColor.trim();
  }

  return Object.freeze({ mode, tokens, backgroundColor });
}
