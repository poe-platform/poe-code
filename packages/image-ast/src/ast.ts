import type {FileSystem} from "@poe-code/safe-fs/contracts";

export type ImageFormat =
  | "sixel"
  | "fits"
  | "pcx"
  | "qoi"
  | "hdr"
  | "exr"
  | "phm"
  | "farbfeld"
  | "xpm"
  | "xwd"
  | "tga"
  | "xbm"
  | "txt"
  | "png"
  | "apng"
  | "mng"
  | "jpeg"
  | "webp"
  | "heic"
  | "heif"
  | "avif"
  | "gif"
  | "pam"
  | "pfm"
  | "pnm"
  | "ppm"
  | "pgm"
  | "pbm"
  | "ico"
  | "cur"
  | "bmp"
  | "psd"
  | "miff"
  | "tiff"
  | "svg"
  | "pdf"
  | "raw";

export type ColorSpace = "srgb" | "b-w" | "cmyk" | "rgb16" | "grey16";

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
  readonly endian?: "lsb" | "msb";
  readonly quality?: number;
  readonly decodeWarnings?: readonly string[];
  /** Original indexed colormap as unsigned 0xAARRGGBB values, in file order. */
  readonly indexedColors?: readonly number[];
  readonly miffPages?: readonly RgbaImage[];
  readonly icoPages?: readonly RgbaImage[];
  readonly tiffPages?: readonly RgbaImage[];
  readonly pngPalette?: { readonly bytes: Uint8Array; readonly depth: number; readonly transparency?: Uint8Array };
  readonly pngIndices?: Uint8Array;
  readonly isPalette?: boolean;
  readonly backgroundColor?: RgbaColor;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  readonly data16?: Uint16Array;
  /** Unclamped arithmetic samples in the 0–255 working range. */
  evaluateSamples?: Float64Array | undefined;
  /** Normalized working color samples; CMYK stores inks separately from RGBA. */
  readonly hueSamples?: Float64Array;
  /** Normalized, unclamped RGBA float samples. */
  readonly dataFloat?: Float32Array;
  readonly format: ImageFormat;
  readonly space: ColorSpace;
  readonly channels: 1 | 2 | 3 | 4 | 5;
  readonly depth: "uchar" | "char" | "ushort" | "short" | "uint" | "int" | "float" | "double" | "bit";
  readonly gamma?: number;
  readonly renderingIntent?: string;
  readonly chromaticity?: NonNullable<ImageMetadata["chromaticity"]>;
  readonly density: number;
  readonly resolution?: NonNullable<ImageMetadata["resolution"]>;
  readonly hasAlpha: boolean;
  readonly isPremultiplied?: boolean;
  readonly wasPremultiplied?: boolean;
  readonly virtualCanvas?: { readonly width: number; readonly height: number; readonly x: number; readonly y: number };
  readonly properties?: Readonly<Record<string, string>>;
  /** Original GIF comment bytes, reused while the comment property is unchanged. */
  readonly gifCommentBytes?: Uint8Array | undefined;
  readonly gifApplications?: Readonly<Record<string, Uint8Array>> | undefined;
  readonly icc?: Uint8Array;
  readonly exif?: Uint8Array;
  readonly xmp?: Uint8Array;
  readonly orientation?: number;
  readonly autoOrient?: { readonly width: number; readonly height: number };
  readonly pages?: number;
  readonly sourcePages?: number;
  readonly pageHeight?: number;
  readonly gifFrames?: readonly { readonly icc?: Uint8Array | undefined; readonly gifApplications?: Readonly<Record<string, Uint8Array>> | undefined; readonly comment?: string | undefined; readonly gifCommentBytes?: Uint8Array | undefined; readonly width: number; readonly height: number; readonly x: number; readonly y: number }[];
  readonly disposal?: number | readonly number[];
  readonly delay?: readonly number[];
  /** Original frame delay count for formats that store ticks separately from the rate. */
  readonly delayTicks?: number;
  /** Tick rate used to express animation delay counts; durations remain milliseconds. */
  readonly ticksPerSecond?: number;
  readonly loop?: number;
  readonly bitsPerSample?: number;
  readonly isProgressive?: boolean;
  readonly trimOffsetLeft?: number;
  readonly trimOffsetTop?: number;
  readonly textAutofitDpi?: number;
}

export interface ImageMetadata {
  readonly endian?: "lsb" | "msb";
  readonly decodeWarnings?: readonly string[];
  readonly jpegSamplingFactor?: string;
  readonly quality?: number;
  readonly isPalette?: boolean;
  readonly backgroundColor?: RgbaColor;
  readonly format: ImageFormat;
  readonly width: number;
  readonly height: number;
  readonly space: ColorSpace;
  readonly channels: 1 | 2 | 3 | 4 | 5;
  readonly depth: "uchar" | "char" | "ushort" | "short" | "uint" | "int" | "float" | "double" | "bit";
  readonly gamma?: number;
  readonly renderingIntent?: string;
  readonly chromaticity?: Readonly<Partial<Record<"red-primary" | "green-primary" | "blue-primary" | "white-point", readonly [number, number]>>>;
  readonly density: number;
  readonly hasAlpha: boolean;
  readonly compression?: "hevc" | "av1";
  readonly resolution?: { readonly x: number; readonly y: number; readonly unit: "meter" | "inch" | "cm" | "unknown" };
  readonly virtualCanvas?: { readonly width: number; readonly height: number; readonly x: number; readonly y: number };
  readonly properties?: Readonly<Record<string, string>>;
  /** Original GIF comment bytes, reused while the comment property is unchanged. */
  readonly gifCommentBytes?: Uint8Array | undefined;
  readonly gifApplications?: Readonly<Record<string, Uint8Array>> | undefined;
  readonly icc?: Uint8Array;
  readonly exif?: Uint8Array;
  readonly xmp?: Uint8Array;
  readonly orientation?: number;
  readonly autoOrient?: { readonly width: number; readonly height: number };
  readonly pages?: number;
  readonly pageHeight?: number;
  readonly pagePrimary?: number;
  readonly delay?: readonly number[];
  /** Tick rate used to express animation delay counts; durations remain milliseconds. */
  readonly ticksPerSecond?: number;
  readonly loop?: number;
  readonly bitsPerSample?: number;
  readonly isProgressive?: boolean;
  readonly size?: number;
}

/** Valid only while its caller-owned backing storage remains open. */
export interface ImageDelayReader {
 readonly length:number;
 at(index:number,options?:{readonly signal?:AbortSignal}):Promise<number|undefined>;
}
export interface RetainedImageMetadata extends ImageMetadata {
 readonly storedDelay?:ImageDelayReader;
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
  readonly depth?: string;
  readonly premultiplied: boolean;
  readonly pageHeight?: number;
  readonly pages?: number;
  readonly trimOffsetLeft?: number;
  readonly trimOffsetTop?: number;
  readonly textAutofitDpi?: number;
  readonly size: number;
}

export type ResizeFit = "cover" | "contain" | "fill" | "inside" | "outside";
export type ResizeKernel =
  | "nearest"
  | "linear"
  | "bilinear"
  | "cubic"
  | "mitchell"
  | "lanczos2"
  | "lanczos3";
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
  | "left top"
  | "entropy"
  | "attention"
  | number;

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
        readonly create?: {
          readonly width: number;
          readonly height: number;
          readonly channels: 1 | 2 | 3 | 4;
          readonly pageHeight?: number;
          readonly background?: ColorInput;
          readonly noise?: {
            readonly type?: "gaussian";
            readonly mean?: number;
            readonly sigma?: number;
          };
        };
        readonly text?: {
          readonly text: string;
          readonly font?: string;
          readonly fontfile?: string;
          readonly width?: number;
          readonly height?: number;
          readonly align?: string;
          readonly justify?: boolean;
          readonly dpi?: number;
          readonly rgba?: boolean;
          readonly spacing?: number;
          readonly wrap?: string;
        };
      };
  readonly top?: number;
  readonly left?: number;
  readonly gravity?: GravityPosition;
  readonly blend?: BlendMode;
  readonly tile?: boolean;
  readonly premultiplied?: boolean;
  readonly density?: number;
  readonly autoOrient?: boolean;
  readonly page?: number;
  readonly pages?: number;
  readonly animated?: boolean;
  readonly raw?: {
    readonly width: number;
    readonly height: number;
    readonly channels: 1 | 2 | 3 | 4;
  };
}

export interface SharpInputOptions {
  /** Explicit virtual filesystem for path inputs and outputs. */
  readonly filesystem?: Pick<FileSystem, "readFile" | "writeFile"> & Partial<FileSystem>;
  readonly signal?: AbortSignal;
  /** Scratch directory in the supplied filesystem. Defaults to output directory for toFile, input directory for file stats, or "." for byte/generated stats. */
  readonly workingDirectory?: string;
  readonly density?: number;
  readonly page?: number;
  readonly pages?: number;
  readonly animated?: boolean;
  /** Decode a single GIF frame rectangle without compositing preceding frames. */
  readonly coalesce?: boolean;
  readonly autoOrient?: boolean;
  /** Preserve Radiance Y scanline order and reject unsupported layouts for ImageMagick compatibility. */
  readonly hdrPreserveScanlineOrder?: boolean;
  readonly limitInputPixels?: number | boolean | undefined;
  readonly sequentialRead?: boolean;
  readonly unlimited?: boolean;
  readonly ignoreIcc?: boolean;
  readonly failOnError?: boolean;
  readonly failOn?: "none" | "truncated" | "error" | "warning";
  readonly maxDecodeDimension?: number;
  readonly raw?: {
    readonly width: number;
    readonly height: number;
    readonly channels: 1 | 2 | 3 | 4;
    readonly premultiplied?: boolean;
    readonly pageHeight?: number;
    readonly depth?: "uchar" | "char" | "ushort" | "short" | "uint" | "int" | "float" | "double" | "bit";
  };
  readonly create?: {
    readonly width: number;
    readonly height: number;
    readonly channels: 1 | 2 | 3 | 4;
    readonly pageHeight?: number;
    readonly background?: ColorInput;
    readonly noise?: {
      readonly type?: "gaussian";
      readonly mean?: number;
      readonly sigma?: number;
    };
  };
  readonly text?: {
    readonly text: string;
    readonly font?: string;
    readonly fontfile?: string;
    readonly width?: number;
    readonly height?: number;
    readonly align?: string;
    readonly justify?: boolean;
    readonly dpi?: number;
    readonly rgba?: boolean;
    readonly spacing?: number;
    readonly wrap?: string;
  };
  readonly join?: {
    readonly across?: number;
    readonly shim?: number;
    readonly background?: ColorInput;
    readonly halign?: string;
    readonly valign?: string;
    readonly animated?: boolean;
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
      readonly lineArt?: boolean;
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
  | { readonly kind: "blur"; readonly sigma: number; readonly minAmplitude?: number; readonly precision?: "integer" | "float" | "approximate" }
  | {
      readonly kind: "sharpen";
      readonly sigma: number;
      readonly m1: number;
      readonly m2: number;
      readonly x1?: number;
      readonly y2?: number;
      readonly y3?: number;
    }
  | { readonly kind: "median"; readonly size: number }
  | { readonly kind: "dilate"; readonly width: number }
  | { readonly kind: "erode"; readonly width: number }
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
  | { readonly kind: "recomb"; readonly matrix: readonly (readonly number[])[] }
  | { readonly kind: "toColorspace"; readonly space: ColorSpace }
  | { readonly kind: "bandbool"; readonly op: "and" | "or" | "eor" }
  | {
      readonly kind: "boolean";
      readonly operand: Uint8Array | string;
      readonly options?: SharpInputOptions;
      readonly op: "and" | "or" | "eor";
    }
  | {
      readonly kind: "joinChannel";
      readonly inputs: ReadonlyArray<{
        readonly data: Uint8Array | string;
        readonly options?: SharpInputOptions;
      }>;
    }
  | {
      readonly kind: "clahe";
      readonly width: number;
      readonly height: number;
      readonly maxSlope: number;
    }
  | {
      readonly kind: "affine";
      readonly matrix: readonly [number, number, number, number];
      readonly background: RgbaColor;
      readonly idx: number;
      readonly idy: number;
      readonly odx: number;
      readonly ody: number;
      readonly interpolator?: string;
    }
  | {
      readonly kind: "withMetadata";
      readonly density?: number;
      readonly orientation?: number;
    };

export interface OutputEncodeOptions {
  /** Output path used to name the C array in XPM source. */
  readonly outputFilename?: string;
  readonly endian?: string | undefined;
  readonly bmpFormat?: "bmp2" | "bmp3" | "bmp4" | "dib";
  readonly bmpRenderingIntent?: string | undefined;
  /** Preserve existing EXIF only when false; PNG stores standalone orientation in orNT. */
  readonly synthesizeExif?: boolean;
  readonly pngColorType?: 0 | 2 | 3 | 4 | 6 | undefined;
  readonly pngCoder?: "png00" | "png8" | "png24" | "png32" | "png48" | "png64" | undefined;
  readonly forceOpaque?: boolean;
  readonly omitPngResolution?: boolean;
  readonly pngPreserveColormap?: boolean | undefined;
  readonly pngInterlace?: boolean | undefined;
  readonly gifInterlace?: boolean | undefined;
  readonly globalPalette?: boolean | undefined;
  readonly pngBitDepth?: 1 | 8 | 16 | undefined;
  readonly consumeInput?: boolean;
  readonly format?: ImageFormat;
  readonly rawDepth?: string;
  readonly miffDepth?: 8 | 16;
  readonly miffCompression?: "none" | "rle" | "bzip" | "zip";
  readonly netpbmDepth?: number;
  readonly netpbmAscii?: boolean;
  readonly tiffBig?: boolean | undefined;
  readonly tiffIntegerDepth?: 8 | 16 | 32;
  readonly tiffSigned?: boolean;
  readonly tiffFloatDepth?: 16 | 32 | 64;
  readonly tiffPlanar?: boolean;
  readonly bmp3Alpha?: boolean;
  readonly bmpSubtype?: "RGB565" | "RGB555" | "ARGB4444" | "ARGB1555";
  readonly tgaCompression?: "none" | "rle";
  readonly bmpCompression?: "none" | "rle";
  readonly tiffAlpha?: "associated" | "unassociated" | "unspecified";
  readonly tiffEndian?: "msb" | "lsb";
  readonly tiffRowsPerStrip?: number;
  readonly tiffTile?: { readonly width: number; readonly height: number };
  readonly tiffCompression?: "none" | "lzw" | "deflate" | "packbits" | "jpeg";
  readonly quality?: number;
  readonly samplingFactor?: string;
  readonly jpegProgressive?: boolean;
  readonly jpegArithmeticCoding?: boolean;
  readonly jpegOptimizeCoding?: boolean;
  readonly jpegDctMethod?: "integer" | "float" | "fastest";
  readonly jpegRestartInterval?: number;
  readonly chromaSubsampling?: "4:2:0" | "4:4:4";
  readonly compression?: "hevc" | "av1";
  readonly compressionLevel?: number;
  readonly palette?: boolean;
  readonly effort?: number;
  readonly lossless?: boolean;
  readonly webpExact?: boolean;
  readonly alphaCompression?: 0 | 1;
  readonly alphaQuality?: number;
  readonly smartSubsample?: boolean;
  readonly density?: number;
  readonly orientation?: number;
  readonly pageHeight?: number;
  readonly delay?: number | readonly number[];
  readonly loop?: number;
  readonly transparentColor?: { readonly r: number; readonly g: number; readonly b: number } | undefined;
  readonly gifVersion?: "87a" | "89a" | undefined;
  readonly optimizeFrames?: boolean;
  readonly gifTransdiff?: boolean;
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
  if (input === undefined) {
    return { r: 0, g: 0, b: 0, a: defaultAlpha };
  }
  if (
    input === null ||
    (typeof input !== "object" && (typeof input !== "string" || input.length < 3 || input.length > 200))
  ) {
    throw new Error(`Expected object or string for background but received ${input} of type ${typeof input}`);
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
  const hslMatch =
    /^hsla?\(\s*([+-]?[\d.]+)\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?(?:\s*,\s*([\d.]+))?\s*\)$/.exec(trimmed);
  if (hslMatch) {
    const h = ((Number(hslMatch[1]) % 360) + 360) % 360;
    const s = Math.max(0, Math.min(100, Number(hslMatch[2]))) / 100;
    const l = Math.max(0, Math.min(100, Number(hslMatch[3]))) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r1 = 0;
    let g1 = 0;
    let b1 = 0;
    if (h < 60) [r1, g1, b1] = [c, x, 0];
    else if (h < 120) [r1, g1, b1] = [x, c, 0];
    else if (h < 180) [r1, g1, b1] = [0, c, x];
    else if (h < 240) [r1, g1, b1] = [0, x, c];
    else if (h < 300) [r1, g1, b1] = [x, 0, c];
    else [r1, g1, b1] = [c, 0, x];
    const alphaRaw = hslMatch[4] !== undefined ? Number(hslMatch[4]) : undefined;
    const a =
      alphaRaw === undefined
        ? defaultAlpha
        : alphaRaw <= 1
          ? clampByte(alphaRaw * 255)
          : clampByte(alphaRaw);
    return {
      r: clampByte((r1 + m) * 255),
      g: clampByte((g1 + m) * 255),
      b: clampByte((b1 + m) * 255),
      a
    };
  }
  throw new Error(`Unable to parse color from string: ${input}`);
}
