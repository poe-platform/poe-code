import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
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
  dilateImage,
  erodeImage,
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

function inferTypedArrayDepth(input: unknown): "uchar" | "char" | "ushort" | "short" | "uint" | "int" | "float" | "double" | undefined {
  if (!input || !ArrayBuffer.isView(input)) return undefined;
  if (input instanceof Int8Array) return "char";
  if (input instanceof Uint16Array) return "ushort";
  if (input instanceof Int16Array) return "short";
  if (input instanceof Uint32Array) return "uint";
  if (input instanceof Int32Array) return "int";
  if (input instanceof Float32Array) return "float";
  if (input instanceof Float64Array) return "double";
  return "uchar";
}

function toBytes(input: Uint8Array | ArrayBuffer | ArrayBufferView | string | undefined): Uint8Array | undefined {
  if (!input) return undefined;
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input === "string") {
    if (input.trimStart().startsWith("<")) {
      return new TextEncoder().encode(input);
    }
    return new Uint8Array(fs.readFileSync(input));
  }
  return undefined;
}

function inferFormatFromPath(fileOut: string): ImageFormat | undefined {
  const ext = path.extname(fileOut).toLowerCase().replace(/^\./, "");
  switch (ext) {
    case "png":
      return "png";
    case "jpg":
    case "jpeg":
    case "jpe":
      return "jpeg";
    case "webp":
      return "webp";
    case "gif":
      return "gif";
    case "tif":
    case "tiff":
      return "tiff";
    case "avif":
      return "avif";
    case "heic":
      return "heic";
    case "heif":
      return "heif";
    case "pdf":
      return "pdf";
    case "ppm":
      return "ppm";
    case "pgm":
      return "pgm";
    case "pbm":
      return "pbm";
    case "bmp":
      return "bmp";
    case "raw":
      return "raw";
    default:
      return undefined;
  }
}

export class SharpInstance {
  private readonly inputBytes: Uint8Array | undefined;
  private readonly inputFilePath: string | undefined;
  private readonly joinInputs: readonly (Uint8Array | ArrayBuffer | string | SharpInputOptions)[] | undefined;
  private readonly inputOptions: SharpInputOptions | undefined;
  private readonly nodes: ImageAstNode[] = [];
  private outputOptions: OutputEncodeOptions = {};

  constructor(
    input?: Uint8Array | ArrayBuffer | string | SharpInputOptions | readonly (Uint8Array | ArrayBuffer | string | SharpInputOptions)[],
    options?: SharpInputOptions
  ) {
    if (Array.isArray(input)) {
      if (input.length < 2) {
        throw new Error("Expected at least two images to join");
      }
      this.inputBytes = undefined;
      this.joinInputs = input;
      this.inputOptions = options;
    } else if (
      input &&
      typeof input === "object" &&
      !ArrayBuffer.isView(input) &&
      !(input instanceof ArrayBuffer)
    ) {
      this.inputBytes = undefined;
      this.joinInputs = undefined;
      this.inputOptions = input as SharpInputOptions;
    } else {
      this.inputFilePath =
        typeof input === "string" && !input.trimStart().startsWith("<") ? input : undefined;
      const inferredDepth = inferTypedArrayDepth(input);
      let effectiveOptions = options;
      if (effectiveOptions?.raw) {
        const { height, pageHeight } = effectiveOptions.raw;
        if (pageHeight !== undefined) {
          if (!Number.isInteger(pageHeight) || pageHeight <= 0 || pageHeight > height) {
            throw new Error(`Expected positive integer for raw.pageHeight but received ${pageHeight}`);
          }
          if (height % pageHeight !== 0) {
            throw new Error(`Expected raw.height ${height} to be a multiple of raw.pageHeight ${pageHeight}`);
          }
        }
        if (inferredDepth && !effectiveOptions.raw.depth) {
          effectiveOptions = {
            ...effectiveOptions,
            raw: {
              ...effectiveOptions.raw,
              depth: inferredDepth
            }
          };
        }
      }
      this.inputBytes = toBytes(input as Uint8Array | ArrayBuffer | ArrayBufferView | string | undefined);
      this.joinInputs = undefined;
      this.inputOptions = effectiveOptions;
    }
    if (this.inputOptions?.autoOrient) {
      this.nodes.push({ kind: "autoOrient" });
    }
  }

  clone(): SharpInstance {
    const copy = new SharpInstance(this.joinInputs ?? this.inputBytes, this.inputOptions);
    copy.nodes.length = 0;
    copy.nodes.push(...this.nodes);
    copy.outputOptions = { ...this.outputOptions };
    return copy;
  }

  private decodeInitialImage(): RgbaImage {
    if (!this.joinInputs) {
      return decodeImage(this.inputBytes, this.inputOptions);
    }
    const imgs = this.joinInputs.map(item => {
      if (item && typeof item === "object" && !(item instanceof Uint8Array) && !(item instanceof ArrayBuffer)) {
        return decodeImage(undefined, item as SharpInputOptions);
      }
      return decodeImage(toBytes(item as Uint8Array | ArrayBuffer | string | undefined), this.inputOptions);
    });
    const n = imgs.length;
    const cellW = Math.max(...imgs.map(i => i.width));
    const cellH = Math.max(...imgs.map(i => i.height));
    const joinOpts = this.inputOptions?.join;
    const animated = Boolean(joinOpts?.animated);
    const across = animated ? 1 : Math.max(1, joinOpts?.across ?? 1);
    const cols = Math.min(n, across);
    const rows = Math.ceil(n / cols);
    const shim = animated ? 0 : Math.max(0, joinOpts?.shim ?? 0);
    const outW = cols * cellW + (cols - 1) * shim;
    const outH = rows * cellH + (rows - 1) * shim;
    const anyAlpha = imgs.some(i => i.hasAlpha);
    const bg = parseColor(joinOpts?.background ?? { r: 0, g: 0, b: 0, alpha: 1 }, 255);
    const hasAlpha = anyAlpha || bg.a < 255;
    const channels = (hasAlpha ? 4 : 3) as 1 | 2 | 3 | 4;
    const out = new Uint8Array(outW * outH * 4);
    for (let p = 0; p < outW * outH; p++) {
      out[p * 4] = bg.r;
      out[p * 4 + 1] = bg.g;
      out[p * 4 + 2] = bg.b;
      out[p * 4 + 3] = hasAlpha ? bg.a : 255;
    }
    const halign = joinOpts?.halign ?? "left";
    const valign = joinOpts?.valign ?? "top";
    for (let k = 0; k < n; k++) {
      const im = imgs[k]!;
      const col = k % cols;
      const row = Math.floor(k / cols);
      const cellX = col * (cellW + shim);
      const cellY = row * (cellH + shim);
      const dx =
        halign === "centre" || halign === "center"
          ? Math.floor((cellW - im.width) / 2)
          : halign === "right" || halign === "high"
            ? cellW - im.width
            : 0;
      const dy =
        valign === "centre" || valign === "center"
          ? Math.floor((cellH - im.height) / 2)
          : valign === "bottom" || valign === "high"
            ? cellH - im.height
            : 0;
      for (let y = 0; y < im.height; y++) {
        const dstY = cellY + dy + y;
        for (let x = 0; x < im.width; x++) {
          const dstX = cellX + dx + x;
          const sIdx = (y * im.width + x) * 4;
          const dIdx = (dstY * outW + dstX) * 4;
          out[dIdx] = im.data[sIdx]!;
          out[dIdx + 1] = im.data[sIdx + 1]!;
          out[dIdx + 2] = im.data[sIdx + 2]!;
          out[dIdx + 3] = im.data[sIdx + 3]!;
        }
      }
    }
    return {
      width: outW,
      height: outH,
      data: out,
      format: "raw",
      space: "srgb",
      channels,
      depth: "uchar",
      density: this.inputOptions?.density ?? 72,
      hasAlpha,
      ...(animated ? { pages: n, pageHeight: cellH } : {})
    };
  }

  getAst(): readonly ImageAstNode[] {
    return this.nodes;
  }

  private upsertNode(nextNode: ImageAstNode, beforeGrayscale = false): void {
    const idx = this.nodes.findIndex(n => n.kind === nextNode.kind);
    if (idx !== -1) {
      this.nodes[idx] = nextNode;
      return;
    }
    if (beforeGrayscale) {
      const grayIdx = this.nodes.findIndex(n => n.kind === "grayscale");
      if (grayIdx !== -1) {
        this.nodes.splice(grayIdx, 0, nextNode);
        return;
      }
    }
    this.nodes.push(nextNode);
  }

  private evaluateImage(): RgbaImage {
    let img = this.decodeInitialImage();
    const orderedNodes = [
      ...this.nodes.filter(n => n.kind !== "withMetadata"),
      ...this.nodes.filter(n => n.kind === "withMetadata")
    ];
    for (const node of orderedNodes) {
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
        case "dilate":
          img = dilateImage(img, node.width);
          break;
        case "erode":
          img = erodeImage(img, node.width);
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
    const computeAutoOrient = (w: number, h: number, orient?: number) =>
      orient !== undefined && orient >= 5 && orient <= 8
        ? { width: h, height: w }
        : { width: w, height: h };
    const rawMeta = this.joinInputs
      ? (() => {
          const joined = this.decodeInitialImage();
          return {
            format: joined.format,
            width: joined.width,
            height: joined.height,
            space: joined.space,
            channels: joined.channels,
            depth: joined.depth,
            density: joined.density,
            hasAlpha: joined.hasAlpha,
            ...(joined.pages !== undefined ? { pages: joined.pages } : {}),
            ...(joined.pageHeight !== undefined ? { pageHeight: joined.pageHeight } : {}),
            size: joined.data.byteLength
          } as ImageMetadata;
        })()
      : readImageMetadata(this.inputBytes, this.inputOptions);
    if (this.nodes.length === 0) {
      return {
        ...rawMeta,
        autoOrient: computeAutoOrient(rawMeta.width, rawMeta.height, rawMeta.orientation)
      };
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
      autoOrient: computeAutoOrient(evaluated.width, evaluated.height, evaluated.orientation),
      ...(evaluated.orientation !== undefined ? { orientation: evaluated.orientation } : {}),
      ...(rawMeta.pages !== undefined ? { pages: rawMeta.pages } : {}),
      ...(rawMeta.pagePrimary !== undefined ? { pagePrimary: rawMeta.pagePrimary } : {}),
      ...(rawMeta.isProgressive !== undefined ? { isProgressive: rawMeta.isProgressive } : {}),
      ...(rawMeta.size !== undefined ? { size: rawMeta.size } : {})
    };
  }

  async metadata(callback?: (err: Error | null, metadata?: ImageMetadata) => void): Promise<ImageMetadata> {
    try {
      const res = this.metadataSync();
      if (callback) callback(null, res);
      return res;
    } catch (err) {
      if (callback) callback(err as Error);
      throw err;
    }
  }

  statsSync(): ImageStats {
    const img = this.evaluateImage();
    return computeImageStats(img);
  }

  async stats(callback?: (err: Error | null, stats?: ImageStats) => void): Promise<ImageStats> {
    try {
      const res = this.statsSync();
      if (callback) callback(null, res);
      return res;
    } catch (err) {
      if (callback) callback(err as Error);
      throw err;
    }
  }

  autoOrient(): this {
    return this.rotate();
  }

  rotate(angle?: number, options?: { readonly background?: ColorInput }): this {
    if (angle === undefined) {
      this.nodes.push({ kind: "autoOrient" });
    } else {
      const nextNode: ImageAstNode = {
        kind: "rotate",
        angle,
        background: parseColor(options?.background, 255)
      };
      const existingIdx = this.nodes.findIndex(n => n.kind === "rotate");
      if (existingIdx !== -1) {
        this.nodes[existingIdx] = nextNode;
      } else {
        this.nodes.push(nextNode);
      }
    }
    return this;
  }

  flip(flip = true): this {
    const existingIdx = this.nodes.findIndex(n => n.kind === "flip");
    if (flip) {
      if (existingIdx !== -1) return this;
      const rotIdx = this.nodes.findIndex(n => n.kind === "rotate");
      if (rotIdx !== -1) this.nodes.splice(rotIdx, 0, { kind: "flip" });
      else this.nodes.push({ kind: "flip" });
    } else if (existingIdx !== -1) {
      this.nodes.splice(existingIdx, 1);
    }
    return this;
  }

  flop(flop = true): this {
    const existingIdx = this.nodes.findIndex(n => n.kind === "flop");
    if (flop) {
      if (existingIdx !== -1) return this;
      const rotIdx = this.nodes.findIndex(n => n.kind === "rotate");
      if (rotIdx !== -1) this.nodes.splice(rotIdx, 0, { kind: "flop" });
      else this.nodes.push({ kind: "flop" });
    } else if (existingIdx !== -1) {
      this.nodes.splice(existingIdx, 1);
    }
    return this;
  }

  extract(region: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  }): this {
    if (!region || typeof region !== "object") {
      throw new Error("Expected object for extract region");
    }
    for (const name of ["left", "top", "width", "height"] as const) {
      const val = region[name];
      if (!Number.isInteger(val) || val < 0) {
        throw new Error(`Expected integer for ${name} but received ${val}`);
      }
    }
    const nextNode: ImageAstNode = {
      kind: "extract",
      left: region.left,
      top: region.top,
      width: region.width,
      height: region.height
    };
    const resizeIdx = this.nodes.findIndex(n => n.kind === "resize");
    const extractIndices: number[] = [];
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i]!.kind === "extract") extractIndices.push(i);
    }
    if (resizeIdx !== -1) {
      const postIdx = extractIndices.find(idx => idx > resizeIdx);
      if (postIdx !== undefined) {
        this.nodes[postIdx] = nextNode;
        return this;
      }
    } else if (extractIndices.length >= 2) {
      this.nodes[extractIndices[1]!] = nextNode;
      return this;
    }
    const extIdx = this.nodes.findIndex(n => n.kind === "extend");
    if (extIdx !== -1) this.nodes.splice(extIdx, 0, nextNode);
    else this.nodes.push(nextNode);
    return this;
  }

  trim(options?: number | { readonly threshold?: number; readonly background?: ColorInput }): this {
    const threshold = typeof options === "number" ? options : (options?.threshold ?? 10);
    const background =
      typeof options === "object" && options?.background
        ? parseColor(options.background)
        : undefined;
    const nextNode: ImageAstNode = { kind: "trim", threshold, ...(background ? { background } : {}) };
    const existingIdx = this.nodes.findIndex(n => n.kind === "trim");
    if (existingIdx !== -1) {
      this.nodes[existingIdx] = nextNode;
      return this;
    }
    const geomIdx = this.nodes.findIndex(
      n => n.kind === "resize" || n.kind === "extend" || n.kind === "extract" || n.kind === "rotate"
    );
    if (geomIdx !== -1) this.nodes.splice(geomIdx, 0, nextNode);
    else this.nodes.push(nextNode);
    return this;
  }

  resize(
    widthOrOptions?: number | null | ResizeOptions,
    height?: number | null,
    options?: ResizeOptions
  ): this {
    let w: number | null = null;
    let h: number | null = null;
    let wProvided = false;
    let hProvided = false;
    let opts: ResizeOptions = {};
    if (typeof widthOrOptions === "object" && widthOrOptions !== null) {
      opts = widthOrOptions;
      w = opts.width ?? null;
      h = opts.height ?? null;
      wProvided = opts.width !== undefined;
      hProvided = true;
    } else {
      opts = options ?? {};
      w = widthOrOptions !== undefined ? widthOrOptions : (opts.width ?? null);
      h = height !== undefined ? height : (opts.height ?? null);
      wProvided = true;
      hProvided = true;
    }
    const existingIdx = this.nodes.findIndex(n => n.kind === "resize");
    if (existingIdx !== -1) {
      const prev = this.nodes[existingIdx] as Extract<ImageAstNode, { readonly kind: "resize" }>;
      this.nodes[existingIdx] = {
        kind: "resize",
        width: wProvided ? w : prev.width,
        height: hProvided ? h : prev.height,
        fit: opts.fit ?? prev.fit,
        position: opts.position ?? prev.position,
        kernel: opts.kernel ?? prev.kernel,
        background: opts.background !== undefined ? parseColor(opts.background, 255) : prev.background,
        withoutEnlargement: opts.withoutEnlargement ?? prev.withoutEnlargement,
        withoutReduction: opts.withoutReduction ?? prev.withoutReduction
      };
      return this;
    }
    const nextResizeNode: ImageAstNode = {
      kind: "resize",
      width: w,
      height: h,
      fit: opts.fit ?? "cover",
      position: opts.position ?? "centre",
      kernel: opts.kernel ?? "lanczos3",
      background: parseColor(opts.background, 255),
      withoutEnlargement: opts.withoutEnlargement ?? false,
      withoutReduction: opts.withoutReduction ?? false
    };
    const extIdx = this.nodes.findIndex(n => n.kind === "extend");
    if (extIdx !== -1) this.nodes.splice(extIdx, 0, nextResizeNode);
    else this.nodes.push(nextResizeNode);
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
    const nextNode: ImageAstNode =
      typeof edges === "number"
        ? {
            kind: "extend",
            top: edges,
            bottom: edges,
            left: edges,
            right: edges,
            background: { r: 0, g: 0, b: 0, a: 255 },
            extendWith: "background"
          }
        : {
            kind: "extend",
            top: edges.top ?? 0,
            bottom: edges.bottom ?? 0,
            left: edges.left ?? 0,
            right: edges.right ?? 0,
            background: parseColor(edges.background, 255),
            extendWith: edges.extendWith ?? "background"
          };
    const existingIdx = this.nodes.findIndex(n => n.kind === "extend");
    if (existingIdx !== -1) {
      this.nodes[existingIdx] = nextNode;
    } else {
      this.nodes.push(nextNode);
    }
    return this;
  }

  composite(images: readonly CompositeLayer[]): this {
    if (!Array.isArray(images)) {
      throw new Error("Expected array for images to composite");
    }
    for (const img of images) {
      if (!img || typeof img !== "object") {
        throw new Error("Expected object for image to composite");
      }
      if ((img.top !== undefined) !== (img.left !== undefined)) {
        throw new Error("Expected both left and top to be set");
      }
      if (img.top !== undefined && !Number.isInteger(img.top)) {
        throw new Error(`Expected integer for top but received ${img.top}`);
      }
      if (img.left !== undefined && !Number.isInteger(img.left)) {
        throw new Error(`Expected integer for left but received ${img.left}`);
      }
    }
    const existingIdx = this.nodes.findIndex(n => n.kind === "composite");
    if (existingIdx !== -1) {
      this.nodes[existingIdx] = { kind: "composite", layers: [...images] };
    } else {
      this.nodes.push({ kind: "composite", layers: [...images] });
    }
    return this;
  }

  grayscale(grayscale = true): this {
    if (grayscale === false) {
      const idx = this.nodes.findIndex(n => n.kind === "grayscale");
      if (idx !== -1) this.nodes.splice(idx, 1);
      return this;
    }
    this.upsertNode({ kind: "grayscale" });
    return this;
  }

  greyscale(greyscale = true): this {
    return this.grayscale(greyscale);
  }

  flatten(options?: boolean | { readonly background?: ColorInput }): this {
    if (options === false) {
      const idx = this.nodes.findIndex(n => n.kind === "flatten");
      if (idx !== -1) this.nodes.splice(idx, 1);
      return this;
    }
    const bg = typeof options === "object" ? options?.background : undefined;
    this.upsertNode({
      kind: "flatten",
      background: parseColor(bg ?? "#000000", 255)
    });
    return this;
  }

  unflatten(): this {
    this.upsertNode({ kind: "unflatten" }, true);
    return this;
  }

  negate(options?: boolean | { readonly alpha?: boolean }): this {
    if (options === false) {
      const idx = this.nodes.findIndex(n => n.kind === "negate");
      if (idx !== -1) this.nodes.splice(idx, 1);
      return this;
    }
    const alpha = typeof options === "object" ? (options.alpha ?? true) : true;
    this.upsertNode({ kind: "negate", alpha });
    return this;
  }

  modulate(options: {
    readonly brightness?: number;
    readonly saturation?: number;
    readonly hue?: number;
    readonly lightness?: number;
  }): this {
    const idx = this.nodes.findIndex(n => n.kind === "modulate");
    if (idx !== -1) {
      const prev = this.nodes[idx] as Extract<ImageAstNode, { readonly kind: "modulate" }>;
      this.nodes[idx] = {
        kind: "modulate",
        brightness: options.brightness ?? prev.brightness,
        saturation: options.saturation ?? prev.saturation,
        hue: options.hue ?? prev.hue,
        lightness: options.lightness ?? prev.lightness
      };
      return this;
    }
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
    this.upsertNode({ kind: "tint", color: parseColor(rgb, 255) }, true);
    return this;
  }

  gamma(gamma = 2.2, gammaOut = gamma): this {
    if (typeof gamma !== "number" || Number.isNaN(gamma) || gamma < 1 || gamma > 3) {
      throw new Error(`Expected number between 1.0 and 3.0 for gamma but received ${gamma}`);
    }
    if (typeof gammaOut !== "number" || Number.isNaN(gammaOut) || gammaOut < 1 || gammaOut > 3) {
      throw new Error(`Expected number between 1.0 and 3.0 for gammaOut but received ${gammaOut}`);
    }
    this.upsertNode({ kind: "gamma", gamma, gammaOut });
    return this;
  }

  linear(a?: number | readonly number[] | null, b?: number | readonly number[] | null): this {
    if (a == null && b == null) {
      const idx = this.nodes.findIndex(n => n.kind === "linear");
      if (idx !== -1) this.nodes.splice(idx, 1);
      return this;
    }
    let effA = a;
    let effB = b;
    if (effA == null && typeof effB === "number") {
      effA = 1.0;
    } else if (typeof effA === "number" && effB == null) {
      effB = 0.0;
    }
    const aArr = effA == null ? [] : typeof effA === "number" ? [effA] : Array.isArray(effA) ? [...effA] : [];
    const bArr = effB == null ? [] : typeof effB === "number" ? [effB] : Array.isArray(effB) ? [...effB] : [];
    if (aArr.length !== bArr.length) {
      throw new Error("Expected a and b to be arrays of the same length");
    }
    this.upsertNode({ kind: "linear", a: aArr, b: bArr });
    return this;
  }

  normalize(
    lowerOrOptions?: number | boolean | { readonly lower?: number; readonly upper?: number },
    upperArg?: number
  ): this {
    if (lowerOrOptions === false) {
      const idx = this.nodes.findIndex(n => n.kind === "normalize");
      if (idx !== -1) this.nodes.splice(idx, 1);
      return this;
    }
    if (lowerOrOptions === true) {
      this.upsertNode({ kind: "normalize", lower: 1, upper: 99 });
      return this;
    }
    if (typeof lowerOrOptions === "number") {
      this.upsertNode({ kind: "normalize",
        lower: lowerOrOptions,
        upper: upperArg ?? 99
      });
    } else {
      this.upsertNode({ kind: "normalize",
        lower: lowerOrOptions?.lower ?? 1,
        upper: lowerOrOptions?.upper ?? 99
      });
    }
    return this;
  }

  normalise(
    lowerOrOptions?: number | boolean | { readonly lower?: number; readonly upper?: number },
    upperArg?: number
  ): this {
    return this.normalize(lowerOrOptions, upperArg);
  }

  threshold(
    threshold: number | boolean = 128,
    options?: { readonly grayscale?: boolean; readonly greyscale?: boolean }
  ): this {
    if (threshold === false || threshold === 0) {
      const idx = this.nodes.findIndex(n => n.kind === "threshold");
      if (idx !== -1) this.nodes.splice(idx, 1);
      return this;
    }
    if (typeof threshold === "number" && (!Number.isInteger(threshold) || threshold < 0 || threshold > 255)) {
      throw new Error(`Expected integer between 0 and 255 for threshold but received ${threshold}`);
    }
    const val = typeof threshold === "number" ? threshold : 128;
    const gs = options?.grayscale ?? options?.greyscale ?? true;
    this.upsertNode({ kind: "threshold", value: val, grayscale: gs });
    return this;
  }

  blur(sigma?: number | boolean | { readonly sigma?: number }): this {
    if (sigma === false) {
      const idx = this.nodes.findIndex(n => n.kind === "blur");
      if (idx !== -1) this.nodes.splice(idx, 1);
      return this;
    }
    if (typeof sigma === "number" && (Number.isNaN(sigma) || sigma < 0.3 || sigma > 1000)) {
      throw new Error(`Expected number between 0.3 and 1000 for sigma but received ${sigma}`);
    }
    if (
      sigma &&
      typeof sigma === "object" &&
      (typeof sigma.sigma !== "number" || Number.isNaN(sigma.sigma) || sigma.sigma < 0.3 || sigma.sigma > 1000)
    ) {
      throw new Error(`Expected number between 0.3 and 1000 for options.sigma but received ${sigma.sigma}`);
    }
    const s =
      sigma === undefined || sigma === true
        ? -1
        : typeof sigma === "number"
          ? sigma
          : (sigma.sigma ?? -1);
    this.upsertNode({ kind: "blur", sigma: s });
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
    if (options === false) {
      const idx = this.nodes.findIndex(n => n.kind === "sharpen");
      if (idx !== -1) this.nodes.splice(idx, 1);
      return this;
    }
    if (options === undefined || options === true) {
      this.upsertNode({ kind: "sharpen", sigma: -1, m1: 1.0, m2: 2.0, x1: 2.0, y2: 10.0, y3: 20.0 });
      return this;
    }
    if (typeof options === "number") {
      if (Number.isNaN(options) || options < 0.01 || options > 10000) {
        throw new Error(`Expected number between 0.01 and 10000 for sigma but received ${options}`);
      }
      this.upsertNode({ kind: "sharpen",
        sigma: options,
        m1: flat ?? 1.0,
        m2: jagged ?? 2.0,
        x1: 2.0,
        y2: 10.0,
        y3: 20.0
      });
      return this;
    }
    if (
      options.sigma !== undefined &&
      (typeof options.sigma !== "number" || Number.isNaN(options.sigma) || options.sigma < 0.000001 || options.sigma > 10)
    ) {
      throw new Error(`Expected number between 0.000001 and 10 for options.sigma but received ${options.sigma}`);
    }
    this.upsertNode({ kind: "sharpen",
      sigma: options.sigma ?? -1,
      m1: options.m1 ?? 1.0,
      m2: options.m2 ?? 2.0,
      x1: options.x1 ?? 2.0,
      y2: options.y2 ?? 10.0,
      y3: options.y3 ?? 20.0
    });
    return this;
  }

  median(size: number | boolean = 3): this {
    if (size === false) {
      const idx = this.nodes.findIndex(n => n.kind === "median");
      if (idx !== -1) this.nodes.splice(idx, 1);
      return this;
    }
    const effSize = size === true ? 3 : size;
    if (!Number.isInteger(effSize) || effSize < 1 || effSize > 1000) {
      throw new Error(`Expected integer between 1 and 1000 for size but received ${size}`);
    }
    this.upsertNode({ kind: "median", size: effSize });
    return this;
  }

  dilate(width = 1): this {
    if (!Number.isInteger(width) || width <= 0) {
      throw new Error(`Expected positive integer for dilate but received ${width}`);
    }
    this.upsertNode({ kind: "dilate", width });
    return this;
  }

  erode(width = 1): this {
    if (!Number.isInteger(width) || width <= 0) {
      throw new Error(`Expected positive integer for erode but received ${width}`);
    }
    this.upsertNode({ kind: "erode", width });
    return this;
  }

  convolve(kernelSpec: {
    readonly width: number;
    readonly height: number;
    readonly kernel: readonly number[];
    readonly scale?: number;
    readonly offset?: number;
  }): this {
    if (
      !kernelSpec ||
      typeof kernelSpec !== "object" ||
      !Array.isArray(kernelSpec.kernel) ||
      !Number.isInteger(kernelSpec.width) ||
      !Number.isInteger(kernelSpec.height) ||
      kernelSpec.width < 3 ||
      kernelSpec.width > 1001 ||
      kernelSpec.height < 3 ||
      kernelSpec.height > 1001 ||
      kernelSpec.width * kernelSpec.height !== kernelSpec.kernel.length
    ) {
      throw new Error("Invalid convolution kernel");
    }
    const defaultScale = kernelSpec.kernel.reduce((s, v) => s + v, 0) || 1;
    this.upsertNode({ kind: "convolve",
      width: kernelSpec.width,
      height: kernelSpec.height,
      kernel: [...kernelSpec.kernel],
      scale: kernelSpec.scale ?? defaultScale,
      offset: kernelSpec.offset ?? 0
    });
    return this;
  }

  ensureAlpha(alpha = 1): this {
    if (typeof alpha !== "number" || Number.isNaN(alpha) || alpha < 0 || alpha > 1) {
      throw new Error(`Expected number between 0 and 1 for alpha but received ${alpha}`);
    }
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
    const ch: number =
      channel === "red"
        ? 0
        : channel === "green"
          ? 1
          : channel === "blue"
            ? 2
            : channel === "alpha"
              ? 3
              : channel;
    if (!Number.isInteger(ch) || ch < 0 || ch > 3) {
      throw new Error(`Expected integer or one of: red, green, blue, alpha for channel but received ${channel}`);
    }
    this.upsertNode({ kind: "extractChannel", channel: ch as 0 | 1 | 2 | 3 });
    return this;
  }

  recomb(matrix: readonly (readonly number[])[]): this {
    if (!Array.isArray(matrix) || (matrix.length !== 3 && matrix.length !== 4)) {
      throw new Error(`Expected 3x3 or 4x4 array for inputMatrix but received ${matrix?.length}`);
    }
    const flatLen = matrix.reduce((acc, row) => acc + (Array.isArray(row) ? row.length : 0), 0);
    if (flatLen !== 9 && flatLen !== 16) {
      throw new Error(`Expected 3x3 or 4x4 array with cardinality of 9 or 16 for inputMatrix`);
    }
    this.upsertNode({ kind: "recomb",
      matrix: matrix.map(row => [...row])
    });
    return this;
  }

  toColorspace(colorspace: string): this {
    const norm = colorspace.toLowerCase();
    const space: ColorSpace =
      norm === "grey16"
        ? "grey16"
        : norm === "rgb16"
          ? "rgb16"
          : norm === "b-w" || norm === "bw" || norm === "gray"
            ? "b-w"
            : norm === "cmyk"
              ? "cmyk"
              : "srgb";
    this.upsertNode({ kind: "toColorspace", space });
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
    if (boolOp !== "and" && boolOp !== "or" && boolOp !== "eor") {
      throw new Error(`Expected one of: and, or, eor for boolOp but received ${boolOp}`);
    }
    this.upsertNode({ kind: "bandbool", op: boolOp });
    return this;
  }

  boolean(
    operand: Uint8Array | ArrayBuffer | string,
    op: "and" | "or" | "eor",
    options?: SharpInputOptions
  ): this {
    if (op !== "and" && op !== "or" && op !== "eor") {
      throw new Error(`Expected one of: and, or, eor for operator but received ${op}`);
    }
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
    images: Uint8Array | ArrayBuffer | ArrayBufferView | string | readonly (Uint8Array | ArrayBuffer | ArrayBufferView | string)[],
    options?: SharpInputOptions
  ): this {
    const list = Array.isArray(images) ? images : [images];
    this.nodes.push({
      kind: "joinChannel",
      inputs: list.map(buf => {
        const data = toBytes(buf as Uint8Array | ArrayBuffer | ArrayBufferView | string);
        if (!data) {
          throw new Error(`Unsupported joinChannel input: ${typeof buf}`);
        }
        return {
          data,
          ...(options !== undefined ? { options } : {})
        };
      })
    });
    return this;
  }

  clahe(options: {
    readonly width: number;
    readonly height: number;
    readonly maxSlope?: number;
  }): this {
    if (!options || typeof options !== "object") {
      throw new Error("Expected plain object for clahe options");
    }
    if (!Number.isInteger(options.width) || options.width <= 0) {
      throw new Error(`Expected integer greater than zero for width but received ${options.width}`);
    }
    if (!Number.isInteger(options.height) || options.height <= 0) {
      throw new Error(`Expected integer greater than zero for height but received ${options.height}`);
    }
    if (options.maxSlope !== undefined && (!Number.isInteger(options.maxSlope) || options.maxSlope < 0 || options.maxSlope > 100)) {
      throw new Error(`Expected integer between 0 and 100 for maxSlope but received ${options.maxSlope}`);
    }
    this.upsertNode({ kind: "clahe",
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
      readonly interpolator?: string;
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
    this.upsertNode({ kind: "affine",
      matrix: flat,
      background: parseColor(options?.background ?? "#000000", 255),
      idx: options?.idx ?? 0,
      idy: options?.idy ?? 0,
      odx: options?.odx ?? 0,
      ody: options?.ody ?? 0,
      ...(options?.interpolator !== undefined ? { interpolator: options.interpolator } : {})
    });
    return this;
  }

  withMetadata(options?: { readonly density?: number; readonly orientation?: number }): this {
    const existingIdx = this.nodes.findIndex(n => n.kind === "withMetadata");
    const prev = existingIdx !== -1 ? (this.nodes[existingIdx] as Extract<ImageAstNode, { readonly kind: "withMetadata" }>) : undefined;
    const density = options?.density ?? prev?.density;
    const orientation = options?.orientation ?? prev?.orientation;
    this.upsertNode({
      kind: "withMetadata",
      ...(density !== undefined ? { density } : {}),
      ...(orientation !== undefined ? { orientation } : {})
    });
    this.outputOptions = {
      ...this.outputOptions,
      ...(density !== undefined ? { density } : {}),
      ...(orientation !== undefined ? { orientation } : {})
    };
    return this;
  }

  keepExif(): this {
    return this.withMetadata();
  }

  withExif(exif: Record<string, Record<string, string>>): this {
    const orientStr = exif?.IFD0?.Orientation;
    const orientNum = orientStr !== undefined ? Number(orientStr) : undefined;
    return this.withMetadata(orientNum !== undefined && Number.isFinite(orientNum) ? { orientation: orientNum } : undefined);
  }

  withExifMerge(exif: Record<string, Record<string, string>>): this {
    return this.withExif(exif);
  }

  keepIccProfile(): this {
    return this;
  }

  withIccProfile(_profile: string, _options?: { readonly attach?: boolean }): this {
    return this;
  }

  timeout(_options?: { readonly seconds?: number }): this {
    return this;
  }

  keepXmp(): this {
    return this;
  }

  withXmp(_xmp: string): this {
    return this;
  }

  keepMetadata(): this {
    return this.withMetadata();
  }

  jp2(_options?: { readonly quality?: number; readonly lossless?: boolean }): this {
    return this.png();
  }

  jxl(_options?: { readonly quality?: number; readonly lossless?: boolean }): this {
    return this.png();
  }

  tile(_options?: Record<string, unknown>): this {
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

  raw(options?: { readonly depth?: string }): this {
    this.outputOptions = {
      ...this.outputOptions,
      format: "raw",
      ...(options?.depth !== undefined ? { rawDepth: options.depth } : {})
    };
    return this;
  }

  toFormat(
    format: ImageFormat | "jpg" | "tif" | "jpe" | { readonly id: string },
    options?: {
      readonly quality?: number;
      readonly compression?: "hevc" | "av1";
      readonly compressionLevel?: number;
      readonly lossless?: boolean;
    }
  ): this {
    const rawFmt = typeof format === "object" && format !== null ? format.id : String(format);
    const lower = rawFmt.toLowerCase();
    const norm: ImageFormat =
      lower === "jpg" || lower === "jpe"
        ? "jpeg"
        : lower === "tif"
          ? "tiff"
          : (lower as ImageFormat);
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
      (img.channels === 2 || (img.channels === 1 && this.nodes.some(n => n.kind === "removeAlpha"))) &&
      !this.nodes.some(
        n =>
          (n.kind === "toColorspace" && n.space === "b-w") ||
          n.kind === "grayscale" ||
          n.kind === "joinChannel" ||
          n.kind === "extractChannel"
      )
    ) {
      img = { ...img, space: "srgb", channels: img.hasAlpha ? 4 : 3 };
    }
    const encoded = encodeImage(img, this.outputOptions);
    const outBuf = Buffer.isBuffer(encoded.data)
      ? encoded.data
      : Buffer.from(encoded.data.buffer, encoded.data.byteOffset, encoded.data.byteLength);
    return {
      data: outBuf,
      info: {
        format: encoded.format,
        width: img.width,
        height: img.height,
        channels: encoded.channels,
        ...(encoded.format === "raw" ? { depth: this.outputOptions.rawDepth ?? img.depth } : {}),
        premultiplied: false,
        ...(img.pageHeight !== undefined ? { pageHeight: img.pageHeight } : {}),
        ...(img.pages !== undefined ? { pages: img.pages } : {}),
        ...(img.trimOffsetLeft !== undefined ? { trimOffsetLeft: img.trimOffsetLeft } : {}),
        ...(img.trimOffsetTop !== undefined ? { trimOffsetTop: img.trimOffsetTop } : {}),
        ...(img.textAutofitDpi !== undefined ? { textAutofitDpi: img.textAutofitDpi } : {}),
        size: encoded.data.byteLength
      }
    };
  }

  toBufferSync(): Uint8Array {
    return this.toBufferWithObjectSync().data;
  }

  async toFile(
    fileOut: string,
    callback?: (err: Error | null, info?: OutputInfo) => void
  ): Promise<OutputInfo> {
    try {
      if (!fileOut || typeof fileOut !== "string") {
        throw new Error("Missing output file path");
      }
      if (this.inputFilePath && path.resolve(fileOut) === path.resolve(this.inputFilePath)) {
        throw new Error("Cannot use same file for input and output");
      }
      const prevFormat = this.outputOptions.format;
      const inferred = prevFormat ?? inferFormatFromPath(fileOut);
      if (!prevFormat && inferred) {
        this.outputOptions = { ...this.outputOptions, format: inferred };
      }
      try {
        const res = this.toBufferWithObjectSync();
        fs.writeFileSync(fileOut, res.data);
        if (callback) callback(null, res.info);
        return res.info;
      } finally {
        if (!prevFormat && inferred) {
          const { format: _omit, ...rest } = this.outputOptions;
          this.outputOptions = rest;
        }
      }
    } catch (err) {
      if (callback) callback(err as Error);
      throw err;
    }
  }

  toBuffer(callback?: (err: Error | null, data?: Uint8Array, info?: OutputInfo) => void): Promise<Uint8Array>;
  toBuffer(options: { readonly resolveWithObject: true }): Promise<{ readonly data: Uint8Array; readonly info: OutputInfo }>;
  toBuffer(options: { readonly resolveWithObject: false }): Promise<Uint8Array>;
  async toBuffer(
    optionsOrCallback?:
      | { readonly resolveWithObject?: boolean }
      | ((err: Error | null, data?: Uint8Array, info?: OutputInfo) => void)
  ): Promise<Uint8Array | { readonly data: Uint8Array; readonly info: OutputInfo }> {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : undefined;
    const options = typeof optionsOrCallback === "object" && optionsOrCallback !== null ? optionsOrCallback : undefined;
    try {
      const res = this.toBufferWithObjectSync();
      if (cb) cb(null, res.data, res.info);
      if (options?.resolveWithObject) {
        return res;
      }
      return res.data;
    } catch (err) {
      if (cb) cb(err as Error);
      throw err;
    }
  }
}

export function sharp(
  input?: Uint8Array | ArrayBuffer | string | SharpInputOptions | readonly (Uint8Array | ArrayBuffer | string | SharpInputOptions)[],
  options?: SharpInputOptions
): SharpInstance {
  return new SharpInstance(input, options);
}

Object.assign(sharp, {
  align: {
    left: "low",
    top: "low",
    low: "low",
    center: "centre",
    centre: "centre",
    right: "high",
    bottom: "high",
    high: "high"
  },
  position: {
    top: 1,
    right: 2,
    bottom: 3,
    left: 4,
    "right top": 5,
    "right bottom": 6,
    "left bottom": 7,
    "left top": 8
  },
  blend: {
    clear: "clear",
    source: "source",
    over: "over",
    in: "in",
    out: "out",
    atop: "atop",
    dest: "dest",
    "dest-over": "dest-over",
    "dest-in": "dest-in",
    "dest-out": "dest-out",
    "dest-atop": "dest-atop",
    xor: "xor",
    add: "add",
    saturate: "saturate",
    multiply: "multiply",
    screen: "screen",
    overlay: "overlay",
    darken: "darken",
    lighten: "lighten",
    "colour-dodge": "colour-dodge",
    "color-dodge": "colour-dodge",
    "colour-burn": "colour-burn",
    "color-burn": "colour-burn",
    "hard-light": "hard-light",
    "soft-light": "soft-light",
    difference: "difference",
    exclusion: "exclusion"
  },
  queue: new EventEmitter(),
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
  colourspace: {
    multiband: "multiband",
    "b-w": "b-w",
    bw: "b-w",
    cmyk: "cmyk",
    srgb: "srgb"
  },
  colorspace: {
    multiband: "multiband",
    "b-w": "b-w",
    bw: "b-w",
    cmyk: "cmyk",
    srgb: "srgb"
  },
  interpolators: {
    nearest: "nearest",
    bilinear: "bilinear",
    bicubic: "bicubic",
    locallyBoundedBicubic: "lbb",
    nohalo: "nohalo",
    vertexSplitQuadraticBasisSpline: "vsqbs"
  },
  format: Object.fromEntries(
    (["jpeg", "png", "webp", "tiff", "heif", "heic", "avif", "gif", "svg", "pdf", "ppm", "pgm", "pbm", "bmp", "raw"] as const).map(
      id => [
        id,
        {
          id,
          input: { file: true, buffer: true, stream: true },
          output: { file: true, buffer: true, stream: true }
        }
      ]
    )
  ) as Record<
    "jpeg" | "png" | "webp" | "tiff" | "heif" | "heic" | "avif" | "gif" | "svg" | "pdf" | "ppm" | "pgm" | "pbm" | "bmp" | "raw",
    { readonly id: string; readonly input: { readonly file: boolean; readonly buffer: boolean; readonly stream: boolean }; readonly output: { readonly file: boolean; readonly buffer: boolean; readonly stream: boolean } }
  >,
  cache: (() => {
    let memMax = 50;
    let filesMax = 20;
    let itemsMax = 100;
    return (options?: boolean | { readonly memory?: number; readonly files?: number; readonly items?: number }) => {
      if (options === false) {
        memMax = 0;
        filesMax = 0;
        itemsMax = 0;
      } else if (options === true) {
        memMax = 50;
        filesMax = 20;
        itemsMax = 100;
      } else if (options && typeof options === "object") {
        if (typeof options.memory === "number") memMax = options.memory;
        if (typeof options.files === "number") filesMax = options.files;
        if (typeof options.items === "number") itemsMax = options.items;
      }
      return {
        memory: { current: 0, high: 0, max: memMax },
        files: { current: 0, max: filesMax },
        items: { current: 0, max: itemsMax }
      };
    };
  })(),
  concurrency: (() => {
    let threads = 4;
    return (n?: number) => {
      if (typeof n === "number" && n > 0) threads = Math.floor(n);
      return threads;
    };
  })(),
  counters: () => ({ queue: 0, process: 0 }),
  simd: (() => {
    let enabled = true;
    return (enable?: boolean) => {
      if (typeof enable === "boolean") enabled = enable;
      return enabled;
    };
  })(),
  block: (_options?: { readonly operation?: readonly string[] }) => {},
  unblock: (_options?: { readonly operation?: readonly string[] }) => {},
  versions: {
    vips: "8.16.1",
    sharp: "0.34.5"
  }
});

export default sharp;
