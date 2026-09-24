import {
  parseColor,
  type ColorInput,
  type CompositeLayer,
  type ImageAstNode,
  type ImageFormat,
  type ImageMetadata,
  type ImageStats,
  type OutputEncodeOptions,
  type OutputInfo,
  type ResizeOptions,
  type RgbaImage,
  type SharpInputOptions
} from "./ast.js";
import { decodeImage, encodeImage, readImageMetadata } from "./codecs/index.js";
import { resizeImage } from "./ops/resize.js";
import {
  applyExifOrientation,
  blurImage,
  compositeImage,
  computeImageStats,
  convolveImage,
  ensureAlphaImage,
  extendImage,
  extractChannelImage,
  extractImage,
  flattenImage,
  flipImage,
  flopImage,
  gammaImage,
  grayscaleImage,
  linearImage,
  medianImage,
  modulateImage,
  negateImage,
  normalizeImage,
  removeAlphaImage,
  rotateImage,
  sharpenImage,
  thresholdImage,
  tintImage,
  trimImage,
  unflattenImage
} from "./ops/transform.js";

function toBytes(input: Uint8Array | ArrayBuffer | string | undefined): Uint8Array | undefined {
  if (!input) return undefined;
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input === "string") return new TextEncoder().encode(input);
  return undefined;
}

export class SharpInstance {
  private readonly inputBytes: Uint8Array | undefined;
  private readonly inputOptions: SharpInputOptions | undefined;
  private readonly nodes: ImageAstNode[] = [];
  private outputOptions: OutputEncodeOptions = {};

  constructor(
    input?: Uint8Array | ArrayBuffer | string | SharpInputOptions,
    options?: SharpInputOptions
  ) {
    if (
      input &&
      typeof input === "object" &&
      !(input instanceof Uint8Array) &&
      !(input instanceof ArrayBuffer)
    ) {
      this.inputBytes = undefined;
      this.inputOptions = input;
    } else {
      this.inputBytes = toBytes(input as Uint8Array | ArrayBuffer | string | undefined);
      this.inputOptions = options;
    }
  }

  clone(): SharpInstance {
    const copy = new SharpInstance(this.inputBytes, this.inputOptions);
    copy.nodes.push(...this.nodes);
    copy.outputOptions = { ...this.outputOptions };
    return copy;
  }

  getAst(): readonly ImageAstNode[] {
    return this.nodes;
  }

  private evaluateImage(): RgbaImage {
    let img = decodeImage(this.inputBytes, this.inputOptions);
    for (const node of this.nodes) {
      switch (node.kind) {
        case "autoOrient":
          img = applyExifOrientation(img);
          break;
        case "rotate":
          img = rotateImage(img, node.angle, node.background);
          break;
        case "flip":
          img = flipImage(img);
          break;
        case "flop":
          img = flopImage(img);
          break;
        case "extract":
          img = extractImage(img, node);
          break;
        case "trim":
          img = trimImage(img, {
            threshold: node.threshold,
            ...(node.background !== undefined ? { background: node.background } : {})
          });
          break;
        case "resize":
          img = resizeImage(img, node);
          break;
        case "extend":
          img = extendImage(img, node);
          break;
        case "composite":
          img = compositeImage(img, node.layers);
          break;
        case "grayscale":
          img = grayscaleImage(img);
          break;
        case "flatten":
          img = flattenImage(img, node.background);
          break;
        case "unflatten":
          img = unflattenImage(img);
          break;
        case "negate":
          img = negateImage(img, { alpha: node.alpha });
          break;
        case "modulate":
          img = modulateImage(img, node);
          break;
        case "tint":
          img = tintImage(img, node.color);
          break;
        case "gamma":
          img = gammaImage(img, node.gamma, node.gammaOut);
          break;
        case "linear":
          img = linearImage(img, node.a, node.b);
          break;
        case "normalize":
          img = normalizeImage(img);
          break;
        case "threshold":
          img = thresholdImage(img, node.value, node.grayscale);
          break;
        case "blur":
          img = blurImage(img, node.sigma);
          break;
        case "sharpen":
          img = sharpenImage(img, node.sigma, node.m1);
          break;
        case "median":
          img = medianImage(img, node.size);
          break;
        case "convolve":
          img = convolveImage(img, node);
          break;
        case "ensureAlpha":
          img = ensureAlphaImage(img, node.alpha);
          break;
        case "removeAlpha":
          img = removeAlphaImage(img);
          break;
        case "extractChannel":
          img = extractChannelImage(img, node.channel);
          break;
        case "withMetadata":
          img = {
            ...img,
            ...(node.density !== undefined ? { density: node.density } : {}),
            ...(node.orientation !== undefined ? { orientation: node.orientation } : {})
          };
          break;
      }
    }
    return img;
  }

  metadataSync(): ImageMetadata {
    const rawMeta = readImageMetadata(this.inputBytes, this.inputOptions);
    if (this.nodes.length === 0) {
      return rawMeta;
    }
    const evaluated = this.evaluateImage();
    return {
      format: this.outputOptions.format ?? evaluated.format,
      width: evaluated.width,
      height: evaluated.height,
      space: evaluated.space,
      channels: evaluated.channels,
      depth: evaluated.depth,
      density: this.outputOptions.density ?? evaluated.density,
      hasAlpha: evaluated.hasAlpha,
      ...(evaluated.orientation !== undefined ? { orientation: evaluated.orientation } : {}),
      ...(rawMeta.pages !== undefined ? { pages: rawMeta.pages } : {}),
      ...(rawMeta.pagePrimary !== undefined ? { pagePrimary: rawMeta.pagePrimary } : {}),
      ...(rawMeta.isProgressive !== undefined ? { isProgressive: rawMeta.isProgressive } : {}),
      ...(rawMeta.size !== undefined ? { size: rawMeta.size } : {})
    };
  }

  async metadata(): Promise<ImageMetadata> {
    return this.metadataSync();
  }

  statsSync(): ImageStats {
    const img = this.evaluateImage();
    return computeImageStats(img);
  }

  async stats(): Promise<ImageStats> {
    return this.statsSync();
  }

  rotate(angle?: number, options?: { readonly background?: ColorInput }): this {
    if (angle === undefined) {
      this.nodes.push({ kind: "autoOrient" });
    } else {
      this.nodes.push({
        kind: "rotate",
        angle,
        background: parseColor(options?.background, 255)
      });
    }
    return this;
  }

  flip(flip = true): this {
    if (flip) this.nodes.push({ kind: "flip" });
    return this;
  }

  flop(flop = true): this {
    if (flop) this.nodes.push({ kind: "flop" });
    return this;
  }

  extract(region: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  }): this {
    this.nodes.push({
      kind: "extract",
      left: region.left,
      top: region.top,
      width: region.width,
      height: region.height
    });
    return this;
  }

  trim(options?: number | { readonly threshold?: number; readonly background?: ColorInput }): this {
    const threshold = typeof options === "number" ? options : (options?.threshold ?? 10);
    const background =
      typeof options === "object" && options?.background
        ? parseColor(options.background)
        : undefined;
    this.nodes.push({ kind: "trim", threshold, ...(background ? { background } : {}) });
    return this;
  }

  resize(
    widthOrOptions?: number | null | ResizeOptions,
    height?: number | null,
    options?: ResizeOptions
  ): this {
    let w: number | null = null;
    let h: number | null = null;
    let opts: ResizeOptions = {};
    if (typeof widthOrOptions === "object" && widthOrOptions !== null) {
      opts = widthOrOptions;
      w = opts.width ?? null;
      h = opts.height ?? null;
    } else {
      w = widthOrOptions ?? null;
      h = height ?? null;
      opts = options ?? {};
    }
    this.nodes.push({
      kind: "resize",
      width: w,
      height: h,
      fit: opts.fit ?? "cover",
      position: opts.position ?? "centre",
      kernel: opts.kernel ?? "lanczos3",
      background: parseColor(opts.background, 255),
      withoutEnlargement: opts.withoutEnlargement ?? false,
      withoutReduction: opts.withoutReduction ?? false
    });
    return this;
  }

  extend(edges: {
    readonly top?: number;
    readonly bottom?: number;
    readonly left?: number;
    readonly right?: number;
    readonly background?: ColorInput;
    readonly extendWith?: "background" | "copy" | "repeat" | "mirror";
  }): this {
    this.nodes.push({
      kind: "extend",
      top: edges.top ?? 0,
      bottom: edges.bottom ?? 0,
      left: edges.left ?? 0,
      right: edges.right ?? 0,
      background: parseColor(edges.background, 255),
      extendWith: edges.extendWith ?? "background"
    });
    return this;
  }

  composite(images: readonly CompositeLayer[]): this {
    this.nodes.push({ kind: "composite", layers: [...images] });
    return this;
  }

  grayscale(grayscale = true): this {
    if (grayscale) this.nodes.push({ kind: "grayscale" });
    return this;
  }

  greyscale(greyscale = true): this {
    return this.grayscale(greyscale);
  }

  flatten(options?: { readonly background?: ColorInput }): this {
    this.nodes.push({
      kind: "flatten",
      background: parseColor(options?.background ?? "#000000", 255)
    });
    return this;
  }

  unflatten(): this {
    this.nodes.push({ kind: "unflatten" });
    return this;
  }

  negate(options?: boolean | { readonly alpha?: boolean }): this {
    if (options === false) return this;
    const alpha = typeof options === "object" ? (options.alpha ?? true) : true;
    this.nodes.push({ kind: "negate", alpha });
    return this;
  }

  modulate(options: {
    readonly brightness?: number;
    readonly saturation?: number;
    readonly hue?: number;
    readonly lightness?: number;
  }): this {
    this.nodes.push({
      kind: "modulate",
      brightness: options.brightness ?? 1,
      saturation: options.saturation ?? 1,
      hue: options.hue ?? 0,
      lightness: options.lightness ?? 0
    });
    return this;
  }

  tint(rgb: ColorInput): this {
    this.nodes.push({ kind: "tint", color: parseColor(rgb, 255) });
    return this;
  }

  gamma(gamma = 2.2, gammaOut = gamma): this {
    this.nodes.push({ kind: "gamma", gamma, gammaOut });
    return this;
  }

  linear(a: number | readonly number[] = 1, b: number | readonly number[] = 0): this {
    const aArr = typeof a === "number" ? [a] : [...a];
    const bArr = typeof b === "number" ? [b] : [...b];
    this.nodes.push({ kind: "linear", a: aArr, b: bArr });
    return this;
  }

  normalize(options?: { readonly lower?: number; readonly upper?: number }): this {
    this.nodes.push({
      kind: "normalize",
      lower: options?.lower ?? 1,
      upper: options?.upper ?? 99
    });
    return this;
  }

  normalise(options?: { readonly lower?: number; readonly upper?: number }): this {
    return this.normalize(options);
  }

  threshold(
    threshold = 128,
    options?: { readonly grayscale?: boolean; readonly greyscale?: boolean }
  ): this {
    const gs = options?.grayscale ?? options?.greyscale ?? true;
    this.nodes.push({ kind: "threshold", value: threshold, grayscale: gs });
    return this;
  }

  blur(sigma: number | boolean = 1.5): this {
    if (sigma === false) return this;
    const s = sigma === true ? 1.5 : sigma;
    this.nodes.push({ kind: "blur", sigma: s });
    return this;
  }

  sharpen(
    options?:
      | number
      | {
          readonly sigma?: number;
          readonly m1?: number;
          readonly m2?: number;
        }
  ): this {
    const sigma = typeof options === "number" ? options : (options?.sigma ?? 1.0);
    const m1 = typeof options === "object" ? (options?.m1 ?? 1.0) : 1.0;
    const m2 = typeof options === "object" ? (options?.m2 ?? 2.0) : 2.0;
    this.nodes.push({ kind: "sharpen", sigma, m1, m2 });
    return this;
  }

  median(size = 3): this {
    this.nodes.push({ kind: "median", size });
    return this;
  }

  convolve(kernelSpec: {
    readonly width: number;
    readonly height: number;
    readonly kernel: readonly number[];
    readonly scale?: number;
    readonly offset?: number;
  }): this {
    const defaultScale = kernelSpec.kernel.reduce((s, v) => s + v, 0) || 1;
    this.nodes.push({
      kind: "convolve",
      width: kernelSpec.width,
      height: kernelSpec.height,
      kernel: [...kernelSpec.kernel],
      scale: kernelSpec.scale ?? defaultScale,
      offset: kernelSpec.offset ?? 0
    });
    return this;
  }

  ensureAlpha(alpha = 1): this {
    this.nodes.push({ kind: "ensureAlpha", alpha });
    return this;
  }

  removeAlpha(): this {
    this.nodes.push({ kind: "removeAlpha" });
    return this;
  }

  extractChannel(channel: 0 | 1 | 2 | 3 | "red" | "green" | "blue" | "alpha"): this {
    const ch: 0 | 1 | 2 | 3 =
      channel === "red"
        ? 0
        : channel === "green"
          ? 1
          : channel === "blue"
            ? 2
            : channel === "alpha"
              ? 3
              : channel;
    this.nodes.push({ kind: "extractChannel", channel: ch });
    return this;
  }

  withMetadata(options?: { readonly density?: number; readonly orientation?: number }): this {
    this.nodes.push({
      kind: "withMetadata",
      ...(options?.density !== undefined ? { density: options.density } : {}),
      ...(options?.orientation !== undefined ? { orientation: options.orientation } : {})
    });
    this.outputOptions = {
      ...this.outputOptions,
      ...(options?.density !== undefined ? { density: options.density } : {}),
      ...(options?.orientation !== undefined ? { orientation: options.orientation } : {})
    };
    return this;
  }

  png(options?: { readonly compressionLevel?: number; readonly palette?: boolean }): this {
    this.outputOptions = {
      ...this.outputOptions,
      format: "png",
      ...(options?.compressionLevel !== undefined
        ? { compressionLevel: options.compressionLevel }
        : {}),
      ...(options?.palette !== undefined ? { palette: options.palette } : {})
    };
    return this;
  }

  jpeg(options?: { readonly quality?: number }): this {
    this.outputOptions = {
      ...this.outputOptions,
      format: "jpeg",
      ...(options?.quality !== undefined ? { quality: options.quality } : {})
    };
    return this;
  }

  webp(options?: { readonly quality?: number; readonly lossless?: boolean }): this {
    this.outputOptions = {
      ...this.outputOptions,
      format: "webp",
      ...(options?.quality !== undefined ? { quality: options.quality } : {}),
      ...(options?.lossless !== undefined ? { lossless: options.lossless } : {})
    };
    return this;
  }

  gif(): this {
    this.outputOptions = { ...this.outputOptions, format: "gif" };
    return this;
  }

  ppm(): this {
    this.outputOptions = { ...this.outputOptions, format: "ppm" };
    return this;
  }

  pgm(): this {
    this.outputOptions = { ...this.outputOptions, format: "pgm" };
    return this;
  }

  pbm(): this {
    this.outputOptions = { ...this.outputOptions, format: "pbm" };
    return this;
  }

  bmp(): this {
    this.outputOptions = { ...this.outputOptions, format: "bmp" };
    return this;
  }

  tiff(): this {
    this.outputOptions = { ...this.outputOptions, format: "tiff" };
    return this;
  }

  raw(): this {
    this.outputOptions = { ...this.outputOptions, format: "raw" };
    return this;
  }

  toFormat(
    format: ImageFormat | "jpg",
    options?: { readonly quality?: number; readonly compressionLevel?: number; readonly lossless?: boolean }
  ): this {
    const norm: ImageFormat = format === "jpg" ? "jpeg" : format;
    this.outputOptions = {
      ...this.outputOptions,
      format: norm,
      ...(options?.quality !== undefined ? { quality: options.quality } : {}),
      ...(options?.compressionLevel !== undefined
        ? { compressionLevel: options.compressionLevel }
        : {}),
      ...(options?.lossless !== undefined ? { lossless: options.lossless } : {})
    };
    return this;
  }

  toBufferWithObjectSync(): { readonly data: Uint8Array; readonly info: OutputInfo } {
    const img = this.evaluateImage();
    const encoded = encodeImage(img, this.outputOptions);
    return {
      data: encoded.data,
      info: {
        format: encoded.format,
        width: img.width,
        height: img.height,
        channels: encoded.channels,
        premultiplied: false,
        size: encoded.data.byteLength
      }
    };
  }

  toBufferSync(): Uint8Array {
    return this.toBufferWithObjectSync().data;
  }

  toBuffer(): Promise<Uint8Array>;
  toBuffer(options: { readonly resolveWithObject: true }): Promise<{ readonly data: Uint8Array; readonly info: OutputInfo }>;
  toBuffer(options: { readonly resolveWithObject: false }): Promise<Uint8Array>;
  async toBuffer(options?: { readonly resolveWithObject?: boolean }): Promise<
    Uint8Array | { readonly data: Uint8Array; readonly info: OutputInfo }
  > {
    const res = this.toBufferWithObjectSync();
    if (options?.resolveWithObject) {
      return res;
    }
    return res.data;
  }
}

export function sharp(
  input?: Uint8Array | ArrayBuffer | string | SharpInputOptions,
  options?: SharpInputOptions
): SharpInstance {
  return new SharpInstance(input, options);
}

export default sharp;
