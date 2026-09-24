export type ImageFormat =
  | "png"
  | "jpeg"
  | "webp"
  | "gif"
  | "ppm"
  | "pgm"
  | "pbm"
  | "bmp"
  | "tiff"
  | "svg"
  | "pdf"
  | "raw";

export type ColorSpace = "srgb" | "b-w" | "cmyk";

export interface RgbaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export type ColorInput =
  | string
  | {
      readonly r: number;
      readonly g: number;
      readonly b: number;
      readonly alpha?: number;
    };

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  readonly format: ImageFormat;
  readonly space: ColorSpace;
  readonly channels: 1 | 2 | 3 | 4;
  readonly depth: "uchar" | "ushort" | "bit";
  readonly density: number;
  readonly hasAlpha: boolean;
  readonly orientation?: number;
  readonly pages?: number;
  readonly isProgressive?: boolean;
}

export interface ImageMetadata {
  readonly format: ImageFormat;
  readonly width: number;
  readonly height: number;
  readonly space: ColorSpace;
  readonly channels: 1 | 2 | 3 | 4;
  readonly depth: "uchar" | "ushort" | "bit";
  readonly density: number;
  readonly hasAlpha: boolean;
  readonly orientation?: number;
  readonly pages?: number;
  readonly pagePrimary?: number;
  readonly isProgressive?: boolean;
  readonly size?: number;
}

export interface ChannelStats {
  readonly min: number;
  readonly max: number;
  readonly sum: number;
  readonly squaresSum: number;
  readonly mean: number;
  readonly stdev: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface ImageStats {
  readonly channels: ChannelStats[];
  readonly isOpaque: boolean;
  readonly entropy: number;
  readonly sharpness: number;
  readonly dominant: { readonly r: number; readonly g: number; readonly b: number };
}

export interface OutputInfo {
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly premultiplied: boolean;
  readonly size: number;
}

export type ResizeFit = "cover" | "contain" | "fill" | "inside" | "outside";
export type ResizeKernel = "nearest" | "bilinear" | "cubic" | "mitchell" | "lanczos2" | "lanczos3";
export type GravityPosition =
  | "center"
  | "centre"
  | "north"
  | "northeast"
  | "east"
  | "southeast"
  | "south"
  | "southwest"
  | "west"
  | "northwest"
  | "top"
  | "right top"
  | "right"
  | "right bottom"
  | "bottom"
  | "left bottom"
  | "left"
  | "left top";

export interface ResizeOptions {
  readonly width?: number | null;
  readonly height?: number | null;
  readonly fit?: ResizeFit;
  readonly position?: GravityPosition;
  readonly kernel?: ResizeKernel;
  readonly background?: ColorInput;
  readonly withoutEnlargement?: boolean;
  readonly withoutReduction?: boolean;
  readonly fastShrinkOnLoad?: boolean;
}

export type BlendMode =
  | "clear"
  | "source"
  | "over"
  | "in"
  | "out"
  | "atop"
  | "dest"
  | "dest-over"
  | "dest-in"
  | "dest-out"
  | "dest-atop"
  | "xor"
  | "add"
  | "saturate"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "colour-dodge"
  | "color-burn"
  | "colour-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion";

export interface CompositeLayer {
  readonly input:
    | Uint8Array
    | string
    | {
        readonly create: {
          readonly width: number;
          readonly height: number;
          readonly channels: 3 | 4;
          readonly background: ColorInput;
        };
      };
  readonly top?: number;
  readonly left?: number;
  readonly gravity?: GravityPosition;
  readonly blend?: BlendMode;
  readonly tile?: boolean;
  readonly premultiplied?: boolean;
  readonly density?: number;
  readonly raw?: {
    readonly width: number;
    readonly height: number;
    readonly channels: 1 | 2 | 3 | 4;
  };
}

export interface SharpInputOptions {
  readonly density?: number;
  readonly page?: number;
  readonly pages?: number;
  readonly limitInputPixels?: number | false;
  readonly failOn?: "none" | "truncated" | "error" | "warning";
  readonly raw?: {
    readonly width: number;
    readonly height: number;
    readonly channels: 1 | 2 | 3 | 4;
    readonly premultiplied?: boolean;
  };
  readonly create?: {
    readonly width: number;
    readonly height: number;
    readonly channels: 3 | 4;
    readonly background: ColorInput;
  };
}

export type ImageAstNode =
  | { readonly kind: "autoOrient" }
  | { readonly kind: "rotate"; readonly angle: number; readonly background: RgbaColor }
  | { readonly kind: "flip" }
  | { readonly kind: "flop" }
  | {
      readonly kind: "extract";
      readonly left: number;
      readonly top: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly kind: "trim";
      readonly threshold: number;
      readonly background?: RgbaColor;
    }
  | {
      readonly kind: "resize";
      readonly width: number | null;
      readonly height: number | null;
      readonly fit: ResizeFit;
      readonly position: GravityPosition;
      readonly kernel: ResizeKernel;
      readonly background: RgbaColor;
      readonly withoutEnlargement: boolean;
      readonly withoutReduction: boolean;
    }
  | {
      readonly kind: "extend";
      readonly top: number;
      readonly bottom: number;
      readonly left: number;
      readonly right: number;
      readonly background: RgbaColor;
      readonly extendWith: "background" | "copy" | "repeat" | "mirror";
    }
  | {
      readonly kind: "composite";
      readonly layers: readonly CompositeLayer[];
    }
  | { readonly kind: "grayscale" }
  | { readonly kind: "flatten"; readonly background: RgbaColor }
  | { readonly kind: "unflatten" }
  | { readonly kind: "negate"; readonly alpha: boolean }
  | {
      readonly kind: "modulate";
      readonly brightness: number;
      readonly saturation: number;
      readonly hue: number;
      readonly lightness: number;
    }
  | { readonly kind: "tint"; readonly color: RgbaColor }
  | { readonly kind: "gamma"; readonly gamma: number; readonly gammaOut: number }
  | { readonly kind: "linear"; readonly a: readonly number[]; readonly b: readonly number[] }
  | { readonly kind: "normalize"; readonly lower: number; readonly upper: number }
  | { readonly kind: "threshold"; readonly value: number; readonly grayscale: boolean }
  | { readonly kind: "blur"; readonly sigma: number }
  | { readonly kind: "sharpen"; readonly sigma: number; readonly m1: number; readonly m2: number }
  | { readonly kind: "median"; readonly size: number }
  | {
      readonly kind: "convolve";
      readonly width: number;
      readonly height: number;
      readonly kernel: readonly number[];
      readonly scale: number;
      readonly offset: number;
    }
  | { readonly kind: "ensureAlpha"; readonly alpha: number }
  | { readonly kind: "removeAlpha" }
  | { readonly kind: "extractChannel"; readonly channel: 0 | 1 | 2 | 3 }
  | {
      readonly kind: "withMetadata";
      readonly density?: number;
      readonly orientation?: number;
    };

export interface OutputEncodeOptions {
  readonly format?: ImageFormat;
  readonly quality?: number;
  readonly compressionLevel?: number;
  readonly palette?: boolean;
  readonly lossless?: boolean;
  readonly density?: number;
  readonly orientation?: number;
}

const NAMED_COLORS: Record<string, [number, number, number, number]> = {
  black: [0, 0, 0, 255],
  white: [255, 255, 255, 255],
  transparent: [0, 0, 0, 0],
  none: [0, 0, 0, 0],
  red: [255, 0, 0, 255],
  green: [0, 128, 0, 255],
  lime: [0, 255, 0, 255],
  blue: [0, 0, 255, 255],
  yellow: [255, 255, 0, 255],
  cyan: [0, 255, 255, 255],
  aqua: [0, 255, 255, 255],
  magenta: [255, 0, 255, 255],
  fuchsia: [255, 0, 255, 255],
  gray: [128, 128, 128, 255],
  grey: [128, 128, 128, 255],
  silver: [192, 192, 192, 255],
  maroon: [128, 0, 0, 255],
  olive: [128, 128, 0, 255],
  purple: [128, 0, 128, 255],
  teal: [0, 128, 128, 255],
  navy: [0, 0, 128, 255],
  orange: [255, 165, 0, 255]
};

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function parseColor(input?: ColorInput, defaultAlpha = 255): RgbaColor {
  if (!input) {
    return { r: 0, g: 0, b: 0, a: defaultAlpha };
  }
  if (typeof input === "object") {
    const alpha =
      input.alpha === undefined
        ? defaultAlpha
        : input.alpha <= 1 && input.alpha >= 0 && !Number.isInteger(input.alpha)
          ? Math.round(input.alpha * 255)
          : input.alpha <= 1 && (input.r > 1 || input.g > 1 || input.b > 1)
            ? Math.round(input.alpha * 255)
            : input.alpha <= 1
              ? Math.round(input.alpha * 255)
              : input.alpha;
    return {
      r: clampByte(input.r),
      g: clampByte(input.g),
      b: clampByte(input.b),
      a: clampByte(alpha)
    };
  }
  const trimmed = input.trim().toLowerCase();
  if (NAMED_COLORS[trimmed]) {
    const [r, g, b, a] = NAMED_COLORS[trimmed]!;
    return { r, g, b, a };
  }
  const hexRaw = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-f]{3}$/.test(hexRaw)) {
    const r = parseInt(hexRaw[0]! + hexRaw[0]!, 16);
    const g = parseInt(hexRaw[1]! + hexRaw[1]!, 16);
    const b = parseInt(hexRaw[2]! + hexRaw[2]!, 16);
    return { r, g, b, a: defaultAlpha };
  }
  if (/^[0-9a-f]{4}$/.test(hexRaw)) {
    const r = parseInt(hexRaw[0]! + hexRaw[0]!, 16);
    const g = parseInt(hexRaw[1]! + hexRaw[1]!, 16);
    const b = parseInt(hexRaw[2]! + hexRaw[2]!, 16);
    const a = parseInt(hexRaw[3]! + hexRaw[3]!, 16);
    return { r, g, b, a };
  }
  if (/^[0-9a-f]{6}$/.test(hexRaw)) {
    const r = parseInt(hexRaw.slice(0, 2), 16);
    const g = parseInt(hexRaw.slice(2, 4), 16);
    const b = parseInt(hexRaw.slice(4, 6), 16);
    return { r, g, b, a: defaultAlpha };
  }
  if (/^[0-9a-f]{8}$/.test(hexRaw)) {
    const r = parseInt(hexRaw.slice(0, 2), 16);
    const g = parseInt(hexRaw.slice(2, 4), 16);
    const b = parseInt(hexRaw.slice(4, 6), 16);
    const a = parseInt(hexRaw.slice(6, 8), 16);
    return { r, g, b, a };
  }
  const rgbMatch = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(
    trimmed
  );
  if (rgbMatch) {
    const r = clampByte(Number(rgbMatch[1]));
    const g = clampByte(Number(rgbMatch[2]));
    const b = clampByte(Number(rgbMatch[3]));
    const alphaRaw = rgbMatch[4] !== undefined ? Number(rgbMatch[4]) : undefined;
    const a =
      alphaRaw === undefined
        ? defaultAlpha
        : alphaRaw <= 1
          ? clampByte(alphaRaw * 255)
          : clampByte(alphaRaw);
    return { r, g, b, a };
  }
  throw new Error(`Unsupported color value: ${input}`);
}
