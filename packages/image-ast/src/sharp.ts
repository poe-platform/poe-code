import {
  parseColor,
  type ColorInput,
  type ColorSpace,
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
  affineImage,
  applyExifOrientation,
  bandboolImage,
  booleanImage,
  blurImage,
  claheImage,
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
  joinChannelImage,
  linearImage,
  medianImage,
  modulateImage,
  negateImage,
  normalizeImage,
  recombImage,
  removeAlphaImage,
  rotateImage,
  sharpenImage,
  thresholdImage,
  tintImage,
  toColorspaceImage,
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
          img = normalizeImage(img, { lower: node.lower, upper: node.upper });
          break;
        case "threshold":
          img = thresholdImage(img, node.value, node.grayscale);
          break;
        case "blur":
          img = blurImage(img, node.sigma);
          break;
        case "sharpen":
          img = sharpenImage(img, node.sigma, node.m1, node.m2, node.x1, node.y2, node.y3);
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
        case "recomb":
          img = recombImage(img, node.matrix);
          break;
        case "toColorspace":
          img = toColorspaceImage(img, node.space);
          break;
        case "bandbool":
          img = bandboolImage(img, node.op);
          break;
        case "boolean": {
          const opImg = decodeImage(node.operand, node.options);
          img = booleanImage(img, opImg, node.op);
          break;
        }
        case "joinChannel": {
          const extras = node.inputs.map(item => decodeImage(item.data, item.options));
          img = joinChannelImage(img, extras);
          break;
        }
        case "clahe":
          img = claheImage(img, node);
          break;
        case "affine":
          img = affineImage(img, node);
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
    if (flip) {
      const rotIdx = this.nodes.findIndex(n => n.kind === "rotate");
      if (rotIdx !== -1) this.nodes.splice(rotIdx, 0, { kind: "flip" });
      else this.nodes.push({ kind: "flip" });
    }
    return this;
  }

  flop(flop = true): this {
    if (flop) {
      const rotIdx = this.nodes.findIndex(n => n.kind === "rotate");
      if (rotIdx !== -1) this.nodes.splice(rotIdx, 0, { kind: "flop" });
      else this.nodes.push({ kind: "flop" });
    }
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

  extend(
    edges:
      | number
      | {
          readonly top?: number;
          readonly bottom?: number;
          readonly left?: number;
          readonly right?: number;
          readonly background?: ColorInput;
          readonly extendWith?: "background" | "copy" | "repeat" | "mirror";
        }
  ): this {
    if (typeof edges === "number") {
      this.nodes.push({
        kind: "extend",
        top: edges,
        bottom: edges,
        left: edges,
        right: edges,
        background: { r: 0, g: 0, b: 0, a: 255 },
        extendWith: "background"
      });
      return this;
    }
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
    const existingIdx = this.nodes.findIndex(n => n.kind === "composite");
    if (existingIdx !== -1) {
      this.nodes[existingIdx] = { kind: "composite", layers: [...images] };
    } else {
      this.nodes.push({ kind: "composite", layers: [...images] });
    }
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

  normalize(
    lowerOrOptions?: number | { readonly lower?: number; readonly upper?: number },
    upperArg?: number
  ): this {
    if (typeof lowerOrOptions === "number") {
      this.nodes.push({
        kind: "normalize",
        lower: lowerOrOptions,
        upper: upperArg ?? 99
      });
    } else {
      this.nodes.push({
        kind: "normalize",
        lower: lowerOrOptions?.lower ?? 1,
        upper: lowerOrOptions?.upper ?? 99
      });
    }
    return this;
  }

  normalise(
    lowerOrOptions?: number | { readonly lower?: number; readonly upper?: number },
    upperArg?: number
  ): this {
    return this.normalize(lowerOrOptions, upperArg);
  }

  threshold(
    threshold = 128,
    options?: { readonly grayscale?: boolean; readonly greyscale?: boolean }
  ): this {
    const gs = options?.grayscale ?? options?.greyscale ?? true;
    this.nodes.push({ kind: "threshold", value: threshold, grayscale: gs });
    return this;
  }

  blur(sigma?: number | boolean | { readonly sigma?: number }): this {
    if (sigma === false) return this;
    const s =
      sigma === undefined || sigma === true
        ? -1
        : typeof sigma === "number"
          ? sigma
          : (sigma.sigma ?? -1);
    this.nodes.push({ kind: "blur", sigma: s });
    return this;
  }

  sharpen(
    options?:
      | number
      | boolean
      | {
          readonly sigma?: number;
          readonly m1?: number;
          readonly m2?: number;
          readonly x1?: number;
          readonly y2?: number;
          readonly y3?: number;
        },
    flat?: number,
    jagged?: number
  ): this {
    if (options === false) return this;
    if (options === undefined || options === true) {
      this.nodes.push({ kind: "sharpen", sigma: -1, m1: 1.0, m2: 2.0, x1: 2.0, y2: 10.0, y3: 20.0 });
      return this;
    }
    if (typeof options === "number") {
      this.nodes.push({
        kind: "sharpen",
        sigma: options,
        m1: flat ?? 1.0,
        m2: jagged ?? 2.0,
        x1: 2.0,
        y2: 10.0,
        y3: 20.0
      });
      return this;
    }
    this.nodes.push({
      kind: "sharpen",
      sigma: options.sigma ?? -1,
      m1: options.m1 ?? 1.0,
      m2: options.m2 ?? 2.0,
      x1: options.x1 ?? 2.0,
      y2: options.y2 ?? 10.0,
      y3: options.y3 ?? 20.0
    });
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
    const grayIdx = this.nodes.findIndex(n => n.kind === "grayscale");
    if (grayIdx !== -1) {
      this.nodes.splice(grayIdx, 0, { kind: "ensureAlpha", alpha });
    } else {
      this.nodes.push({ kind: "ensureAlpha", alpha });
    }
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

  recomb(matrix: readonly (readonly number[])[]): this {
    this.nodes.push({
      kind: "recomb",
      matrix: matrix.map(row => [...row])
    });
    return this;
  }

  toColorspace(colorspace: string): this {
    const norm = colorspace.toLowerCase();
    const space: ColorSpace =
      norm === "b-w" || norm === "grey16" || norm === "gray"
        ? "b-w"
        : norm === "cmyk"
          ? "cmyk"
          : "srgb";
    this.nodes.push({ kind: "toColorspace", space });
    return this;
  }

  toColourspace(colourspace: string): this {
    return this.toColorspace(colourspace);
  }

  pipelineColorspace(colorspace: string): this {
    return this.toColorspace(colorspace);
  }

  pipelineColourspace(colourspace: string): this {
    return this.toColorspace(colourspace);
  }

  bandbool(boolOp: "and" | "or" | "eor"): this {
    this.nodes.push({ kind: "bandbool", op: boolOp });
    return this;
  }

  boolean(
    operand: Uint8Array | ArrayBuffer | string,
    op: "and" | "or" | "eor",
    options?: SharpInputOptions
  ): this {
    const data = toBytes(operand);
    if (data) {
      this.nodes.push({
        kind: "boolean",
        operand: data,
        op,
        ...(options?.raw !== undefined ? { options: { raw: options.raw } } : {})
      });
    }
    return this;
  }

  joinChannel(
    images: Uint8Array | ArrayBuffer | readonly (Uint8Array | ArrayBuffer)[],
    options?: SharpInputOptions
  ): this {
    const list = Array.isArray(images) ? images : [images];
    this.nodes.push({
      kind: "joinChannel",
      inputs: list.map(buf => ({
        data: buf instanceof Uint8Array ? buf : new Uint8Array(buf),
        ...(options !== undefined ? { options } : {})
      }))
    });
    return this;
  }

  clahe(options: {
    readonly width: number;
    readonly height: number;
    readonly maxSlope?: number;
  }): this {
    this.nodes.push({
      kind: "clahe",
      width: options.width,
      height: options.height,
      maxSlope: options.maxSlope ?? 3
    });
    return this;
  }

  affine(
    matrix: readonly [number, number, number, number] | readonly (readonly number[])[],
    options?: {
      readonly background?: ColorInput;
      readonly idx?: number;
      readonly idy?: number;
      readonly odx?: number;
      readonly ody?: number;
    }
  ): this {
    const flat: [number, number, number, number] = Array.isArray(matrix[0])
      ? [
          (matrix as readonly (readonly number[])[])[0]?.[0] ?? 1,
          (matrix as readonly (readonly number[])[])[0]?.[1] ?? 0,
          (matrix as readonly (readonly number[])[])[1]?.[0] ?? 0,
          (matrix as readonly (readonly number[])[])[1]?.[1] ?? 1
        ]
      : [
          (matrix as readonly number[])[0] ?? 1,
          (matrix as readonly number[])[1] ?? 0,
          (matrix as readonly number[])[2] ?? 0,
          (matrix as readonly number[])[3] ?? 1
        ];
    this.nodes.push({
      kind: "affine",
      matrix: flat,
      background: parseColor(options?.background ?? "#000000", 255),
      idx: options?.idx ?? 0,
      idy: options?.idy ?? 0,
      odx: options?.odx ?? 0,
      ody: options?.ody ?? 0
    });
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

  heif(options?: {
    readonly quality?: number;
    readonly compression?: "hevc" | "av1";
    readonly lossless?: boolean;
  }): this {
    this.outputOptions = {
      ...this.outputOptions,
      format: "heif",
      ...(options?.quality !== undefined ? { quality: options.quality } : {}),
      ...(options?.compression !== undefined ? { compression: options.compression } : {}),
      ...(options?.lossless !== undefined ? { lossless: options.lossless } : {})
    };
    return this;
  }

  heic(options?: {
    readonly quality?: number;
    readonly compression?: "hevc" | "av1";
    readonly lossless?: boolean;
  }): this {
    this.outputOptions = {
      ...this.outputOptions,
      format: "heic",
      compression: options?.compression ?? "hevc",
      ...(options?.quality !== undefined ? { quality: options.quality } : {}),
      ...(options?.lossless !== undefined ? { lossless: options.lossless } : {})
    };
    return this;
  }

  avif(options?: { readonly quality?: number; readonly lossless?: boolean }): this {
    this.outputOptions = {
      ...this.outputOptions,
      format: "avif",
      compression: "av1",
      ...(options?.quality !== undefined ? { quality: options.quality } : {}),
      ...(options?.lossless !== undefined ? { lossless: options.lossless } : {})
    };
    return this;
  }

  gif(options?: {
    readonly pageHeight?: number;
    readonly delay?: number | readonly number[];
    readonly loop?: number;
  }): this {
    this.outputOptions = {
      ...this.outputOptions,
      format: "gif",
      ...(options?.pageHeight !== undefined ? { pageHeight: options.pageHeight } : {}),
      ...(options?.delay !== undefined ? { delay: options.delay } : {}),
      ...(options?.loop !== undefined ? { loop: options.loop } : {})
    };
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
    options?: {
      readonly quality?: number;
      readonly compression?: "hevc" | "av1";
      readonly compressionLevel?: number;
      readonly lossless?: boolean;
    }
  ): this {
    const norm: ImageFormat = format === "jpg" ? "jpeg" : format;
    this.outputOptions = {
      ...this.outputOptions,
      format: norm,
      ...(options?.quality !== undefined ? { quality: options.quality } : {}),
      ...(options?.compression !== undefined ? { compression: options.compression } : {}),
      ...(options?.compressionLevel !== undefined
        ? { compressionLevel: options.compressionLevel }
        : {}),
      ...(options?.lossless !== undefined ? { lossless: options.lossless } : {})
    };
    return this;
  }

  toBufferWithObjectSync(): { readonly data: Uint8Array; readonly info: OutputInfo } {
    let img = this.evaluateImage();
    if (
      this.outputOptions.format === "raw" &&
      img.channels === 2 &&
      !this.nodes.some(
        n => (n.kind === "toColorspace" && n.space === "b-w") || n.kind === "grayscale" || n.kind === "joinChannel"
      )
    ) {
      img = { ...img, space: "srgb", channels: 4 };
    }
    const encoded = encodeImage(img, this.outputOptions);
    return {
      data: encoded.data,
      info: {
        format: encoded.format,
        width: img.width,
        height: img.height,
        channels: encoded.channels,
        ...(encoded.format === "raw" ? { depth: img.depth } : {}),
        premultiplied: false,
        ...(img.pageHeight !== undefined ? { pageHeight: img.pageHeight } : {}),
        ...(img.pages !== undefined ? { pages: img.pages } : {}),
        ...(img.trimOffsetLeft !== undefined ? { trimOffsetLeft: img.trimOffsetLeft } : {}),
        ...(img.trimOffsetTop !== undefined ? { trimOffsetTop: img.trimOffsetTop } : {}),
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

Object.assign(sharp, {
  gravity: {
    center: 0,
    centre: 0,
    north: 1,
    east: 2,
    south: 3,
    west: 4,
    northeast: 5,
    southeast: 6,
    southwest: 7,
    northwest: 8
  },
  fit: {
    contain: "contain",
    cover: "cover",
    fill: "fill",
    inside: "inside",
    outside: "outside"
  },
  kernel: {
    nearest: "nearest",
    linear: "linear",
    cubic: "cubic",
    mitchell: "mitchell",
    lanczos2: "lanczos2",
    lanczos3: "lanczos3",
    mks2013: "mks2013",
    mks2021: "mks2021"
  },
  bool: {
    and: "and",
    or: "or",
    eor: "eor"
  },
  strategy: {
    entropy: 16,
    attention: 17
  },
  versions: {
    vips: "8.16.1",
    sharp: "0.34.5"
  }
});

export default sharp;
