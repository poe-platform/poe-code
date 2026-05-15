import { supportsColor } from "../internal/color-support.js";

type AnsiStyleName =
  | "reset"
  | "bold"
  | "dim"
  | "italic"
  | "underline"
  | "inverse"
  | "strikethrough"
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "gray"
  | "magentaBright"
  | "cyanBright"
  | "bgRed"
  | "bgGreen"
  | "bgYellow"
  | "bgBlue"
  | "bgMagenta";

interface AnsiPair {
  open: string;
  close: string;
}

export interface Color {
  (text: string): string;
  reset: Color;
  bold: Color;
  dim: Color;
  italic: Color;
  underline: Color;
  inverse: Color;
  strikethrough: Color;
  black: Color;
  red: Color;
  green: Color;
  yellow: Color;
  blue: Color;
  magenta: Color;
  cyan: Color;
  white: Color;
  gray: Color;
  magentaBright: Color;
  cyanBright: Color;
  bgRed: Color;
  bgGreen: Color;
  bgYellow: Color;
  bgBlue: Color;
  bgMagenta: Color;
  hex: (value: string) => Color;
  rgb: (red: number, green: number, blue: number) => Color;
  bgHex: (value: string) => Color;
  bgRgb: (red: number, green: number, blue: number) => Color;
}

const ansiStyles: Record<AnsiStyleName, AnsiPair> = {
  reset: { open: "\u001b[0m", close: "\u001b[0m" },
  bold: { open: "\u001b[1m", close: "\u001b[22m" },
  dim: { open: "\u001b[2m", close: "\u001b[22m" },
  italic: { open: "\u001b[3m", close: "\u001b[23m" },
  underline: { open: "\u001b[4m", close: "\u001b[24m" },
  inverse: { open: "\u001b[7m", close: "\u001b[27m" },
  strikethrough: { open: "\u001b[9m", close: "\u001b[29m" },
  black: { open: "\u001b[30m", close: "\u001b[39m" },
  red: { open: "\u001b[31m", close: "\u001b[39m" },
  green: { open: "\u001b[32m", close: "\u001b[39m" },
  yellow: { open: "\u001b[33m", close: "\u001b[39m" },
  blue: { open: "\u001b[34m", close: "\u001b[39m" },
  magenta: { open: "\u001b[35m", close: "\u001b[39m" },
  cyan: { open: "\u001b[36m", close: "\u001b[39m" },
  white: { open: "\u001b[37m", close: "\u001b[39m" },
  gray: { open: "\u001b[90m", close: "\u001b[39m" },
  magentaBright: { open: "\u001b[95m", close: "\u001b[39m" },
  cyanBright: { open: "\u001b[96m", close: "\u001b[39m" },
  bgRed: { open: "\u001b[41m", close: "\u001b[49m" },
  bgGreen: { open: "\u001b[42m", close: "\u001b[49m" },
  bgYellow: { open: "\u001b[43m", close: "\u001b[49m" },
  bgBlue: { open: "\u001b[44m", close: "\u001b[49m" },
  bgMagenta: { open: "\u001b[45m", close: "\u001b[49m" }
};

const styleNames = Object.keys(ansiStyles) as AnsiStyleName[];

function replaceAll(value: string, search: string, replacement: string): string {
  return value.split(search).join(replacement);
}

function applyStyles(text: string, styles: AnsiPair[]): string {
  if (!supportsColor() || styles.length === 0) {
    return text;
  }

  let output = text;
  for (const style of styles) {
    if (output.includes(style.close)) {
      output = replaceAll(output, style.close, `${style.close}${style.open}`);
    }
  }

  const open = styles.map((style) => style.open).join("");
  const close = styles
    .map((style) => style.close)
    .reverse()
    .join("");

  return `${open}${output}${close}`;
}

function clampRgb(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.min(255, Math.max(0, Math.round(value)));
}

function hexChannel(value: string, offset: number): number {
  return Number.parseInt(value.slice(offset, offset + 2), 16);
}

function normalizeHex(value: string): [number, number, number] {
  const normalized = value.startsWith("#") ? value.slice(1) : value;

  if (normalized.length === 3) {
    const red = normalized[0]!;
    const green = normalized[1]!;
    const blue = normalized[2]!;

    return [
      Number.parseInt(`${red}${red}`, 16),
      Number.parseInt(`${green}${green}`, 16),
      Number.parseInt(`${blue}${blue}`, 16)
    ];
  }

  if (normalized.length === 6) {
    return [
      hexChannel(normalized, 0),
      hexChannel(normalized, 2),
      hexChannel(normalized, 4)
    ];
  }

  return [0, 0, 0];
}

function rgbStyle(red: number, green: number, blue: number): AnsiPair {
  return {
    open: `\u001b[38;2;${clampRgb(red)};${clampRgb(green)};${clampRgb(blue)}m`,
    close: "\u001b[39m"
  };
}

function bgRgbStyle(red: number, green: number, blue: number): AnsiPair {
  return {
    open: `\u001b[48;2;${clampRgb(red)};${clampRgb(green)};${clampRgb(blue)}m`,
    close: "\u001b[49m"
  };
}

function createColor(styles: AnsiPair[] = []): Color {
  const builder = ((text: string) => applyStyles(String(text), styles)) as Color;

  for (const name of styleNames) {
    Object.defineProperty(builder, name, {
      configurable: true,
      enumerable: true,
      get: () => createColor([...styles, ansiStyles[name]])
    });
  }

  builder.hex = (value: string) => {
    const [red, green, blue] = normalizeHex(value);
    return createColor([...styles, rgbStyle(red, green, blue)]);
  };

  builder.rgb = (red: number, green: number, blue: number) =>
    createColor([...styles, rgbStyle(red, green, blue)]);

  builder.bgHex = (value: string) => {
    const [red, green, blue] = normalizeHex(value);
    return createColor([...styles, bgRgbStyle(red, green, blue)]);
  };

  builder.bgRgb = (red: number, green: number, blue: number) =>
    createColor([...styles, bgRgbStyle(red, green, blue)]);

  return builder;
}

export const color = createColor();
