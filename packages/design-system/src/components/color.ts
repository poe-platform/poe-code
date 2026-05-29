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

const reset = "\x1b[0m";

const ansiStyles: Record<AnsiStyleName, AnsiPair> = {
  reset: { open: reset },
  bold: { open: "\x1b[1m" },
  dim: { open: "\x1b[2m" },
  italic: { open: "\x1b[3m" },
  underline: { open: "\x1b[4m" },
  inverse: { open: "\x1b[7m" },
  strikethrough: { open: "\x1b[9m" },
  black: { open: "\x1b[30m" },
  red: { open: "\x1b[31m" },
  green: { open: "\x1b[32m" },
  yellow: { open: "\x1b[33m" },
  blue: { open: "\x1b[34m" },
  magenta: { open: "\x1b[35m" },
  cyan: { open: "\x1b[36m" },
  white: { open: "\x1b[37m" },
  gray: { open: "\x1b[90m" },
  magentaBright: { open: "\x1b[95m" },
  cyanBright: { open: "\x1b[96m" },
  bgRed: { open: "\x1b[41m" },
  bgGreen: { open: "\x1b[42m" },
  bgYellow: { open: "\x1b[43m" },
  bgBlue: { open: "\x1b[44m" },
  bgMagenta: { open: "\x1b[45m" }
};

const styleNames = Object.keys(ansiStyles) as AnsiStyleName[];

function replaceAll(value: string, search: string, replacement: string): string {
  return value.split(search).join(replacement);
}

function applyStyles(text: string, styles: AnsiPair[]): string {
  if (!supportsColor() || styles.length === 0) {
    return text;
  }

  const open = styles.map((style) => style.open).join("");
  const output = text.includes(reset) ? replaceAll(text, reset, `${reset}${open}`) : text;

  return `${open}${output}${reset}`;
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

  if ((normalized.length !== 3 && normalized.length !== 6) ||
    Array.from(normalized).some((char) => !"0123456789abcdefABCDEF".includes(char))) {
    throw new Error(`Invalid hexadecimal color: ${value}`);
  }

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

  return [
    hexChannel(normalized, 0),
    hexChannel(normalized, 2),
    hexChannel(normalized, 4)
  ];
}

function rgbStyle(red: number, green: number, blue: number): AnsiPair {
  return {
    open: `\x1b[38;2;${clampRgb(red)};${clampRgb(green)};${clampRgb(blue)}m`
  };
}

function bgRgbStyle(red: number, green: number, blue: number): AnsiPair {
  return {
    open: `\x1b[48;2;${clampRgb(red)};${clampRgb(green)};${clampRgb(blue)}m`
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
