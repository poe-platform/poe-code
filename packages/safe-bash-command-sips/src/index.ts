import {
  commandRuntimeIdentity,
  getCommandArguments,
  type CommandContext,
  type CommandDefinition
} from "safe-bash-contracts/command";
import { readBytes, writeBytes } from "safe-bash-contracts/io";
import { createOutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import sharp, {
  parseColor,
  type ImageFormat,
  type ImageMetadata,
  type SharpInstance
} from "@poe-code/image-ast";

export interface SipsCommandOptions {
  readonly replace?: boolean;
}

export interface SipsCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

type SipsAction =
  | { readonly kind: "rotate"; readonly degrees: number }
  | { readonly kind: "flip"; readonly direction: "horizontal" | "vertical" }
  | { readonly kind: "crop"; readonly height: number; readonly width: number }
  | { readonly kind: "resampleMax"; readonly maxDim: number }
  | { readonly kind: "resampleHW"; readonly height: number; readonly width: number }
  | { readonly kind: "resampleW"; readonly width: number }
  | { readonly kind: "resampleH"; readonly height: number }
  | { readonly kind: "pad"; readonly height: number; readonly width: number };

const SIPS_BUFFER_PROPS = new WeakMap<Uint8Array, Map<string, string | null>>();

function formatToTypeIdentifier(fmt: ImageFormat): string {
  switch (fmt) {
    case "png":
      return "public.png";
    case "jpeg":
      return "public.jpeg";
    case "webp":
      return "org.webmproject.webp";
    case "heic":
      return "public.heic";
    case "heif":
      return "public.heif";
    case "avif":
      return "public.avif";
    case "gif":
      return "com.compuserve.gif";
    case "ppm":
    case "pgm":
    case "pbm":
      return "public.pbm";
    case "bmp":
      return "com.microsoft.bmp";
    case "tiff":
      return "public.tiff";
    case "pdf":
      return "com.adobe.pdf";
    case "svg":
      return "public.svg-image";
    default:
      return "public.image";
  }
}

function formatSipsPropertyValue(
  meta: ImageMetadata,
  key: string,
  customProps?: ReadonlyMap<string, string | null>
): string | undefined {
  if (customProps?.has(key)) {
    const v = customProps.get(key);
    return v === null ? undefined : v;
  }
  switch (key) {
    case "pixelWidth":
      return String(meta.width);
    case "pixelHeight":
      return String(meta.height);
    case "typeIdentifier":
      return formatToTypeIdentifier(meta.format);
    case "format":
      return meta.format;
    case "formatOptions":
      return "default";
    case "dpiWidth":
      return `${(meta.density ?? 72).toFixed(3)}`;
    case "dpiHeight":
      return `${(meta.density ?? 72).toFixed(3)}`;
    case "samplesPerPixel":
      return String(meta.channels);
    case "bitsPerSample":
      return meta.depth === "ushort" ? "16" : meta.depth === "bit" ? "1" : "8";
    case "hasAlpha":
      return meta.hasAlpha ? "yes" : "no";
    case "space":
      return meta.space === "b-w" ? "Gray" : meta.space === "cmyk" ? "CMYK" : "RGB";
    default:
      return undefined;
  }
}

const ALL_SIPS_KEYS = [
  "pixelWidth",
  "pixelHeight",
  "typeIdentifier",
  "format",
  "formatOptions",
  "dpiWidth",
  "dpiHeight",
  "samplesPerPixel",
  "bitsPerSample",
  "hasAlpha",
  "space"
];

function resolveQualityOption(opt: string | undefined): number {
  if (!opt) return 85;
  const lower = opt.toLowerCase().trim();
  if (lower === "low") return 30;
  if (lower === "normal") return 60;
  if (lower === "default") return 85;
  if (lower === "high") return 85;
  if (lower === "best") return 95;
  const num = Number(lower);
  if (Number.isFinite(num) && num >= 1 && num <= 100) return Math.round(num);
  return 85;
}

function normalizeTargetFormat(fmt: string): ImageFormat | undefined {
  const lower = fmt.toLowerCase().trim();
  if (lower === "png" || lower === "public.png") return "png";
  if (lower === "jpeg" || lower === "jpg" || lower === "public.jpeg") return "jpeg";
  if (lower === "webp" || lower === "org.webmproject.webp") return "webp";
  if (lower === "heic" || lower === "public.heic") return "heic";
  if (lower === "heif" || lower === "public.heif") return "heif";
  if (lower === "avif" || lower === "public.avif") return "avif";
  if (lower === "gif" || lower === "com.compuserve.gif") return "gif";
  if (lower === "ppm") return "ppm";
  if (lower === "pgm") return "pgm";
  if (lower === "pbm" || lower === "public.pbm") return "pbm";
  if (lower === "bmp" || lower === "com.microsoft.bmp") return "bmp";
  if (lower === "tiff" || lower === "tif" || lower === "public.tiff") return "tiff";
  if (lower === "pdf" || lower === "com.adobe.pdf") return "pdf";
  return undefined;
}

async function applySipsOddCanvasCropOrPad(
  inst: SharpInstance,
  curW: number,
  curH: number,
  dstW: number,
  dstH: number,
  padColorInput: { readonly r: number; readonly g: number; readonly b: number; readonly alpha?: number } | string
): Promise<SharpInstance> {
  const rawObj = await inst.raw().toBuffer({ resolveWithObject: true });
  const ch = rawObj.info.channels as 1 | 2 | 3 | 4;
  const src = rawObj.data;
  const pad = parseColor(padColorInput, ch === 4 || ch === 2 ? 0 : 255);
  const bg = [pad.r, pad.g, pad.b, pad.a];
  const offsetX = (dstW - curW) / 2;
  const offsetY = (dstH - curH) / 2;
  const out = new Uint8Array(dstW * dstH * ch);

  const sampleCh = (ix: number, iy: number, c: number): number => {
    if (ix < 0 || ix >= curW || iy < 0 || iy >= curH) {
      return bg[c] ?? 0;
    }
    return src[(iy * curW + ix) * ch + c]!;
  };

  for (let y = 0; y < dstH; y++) {
    const sy = y - offsetY;
    const iy0 = Math.floor(sy);
    const wy1 = sy - iy0;
    const wy0 = 1 - wy1;
    const iy1 = iy0 + 1;
    for (let x = 0; x < dstW; x++) {
      const sx = x - offsetX;
      const ix0 = Math.floor(sx);
      const wx1 = sx - ix0;
      const wx0 = 1 - wx1;
      const ix1 = ix0 + 1;
      const dIdx = (y * dstW + x) * ch;
      for (let c = 0; c < ch; c++) {
        const v =
          sampleCh(ix0, iy0, c) * wx0 * wy0 +
          sampleCh(ix1, iy0, c) * wx1 * wy0 +
          sampleCh(ix0, iy1, c) * wx0 * wy1 +
          sampleCh(ix1, iy1, c) * wx1 * wy1;
        out[dIdx + c] = Math.max(0, Math.min(255, Math.round(v)));
      }
    }
  }
  return sharp(out, { raw: { width: dstW, height: dstH, channels: ch } });
}

export async function runSipsCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>
): Promise<SipsCliResult> {
  if (argv.length === 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "sips: no arguments specified. Try 'sips --help' for help.\n"
    };
  }

  let singleLine = false;
  let outTarget: string | undefined;
  let padColor: string | undefined;
  let cropOffsetY: number | undefined;
  let cropOffsetX: number | undefined;
  let targetFormat: ImageFormat | undefined;
  let formatOptionsStr: string | undefined;
  let targetDpi: number | undefined;
  const customSetProps = new Map<string, string | null>();
  let verifyMode = false;
  let propertyMutated = false;
  const getProperties: string[] = [];
  const actions: SipsAction[] = [];
  const inputPaths: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") {
      return {
        exitCode: 0,
        stdout:
          "sips - scriptable image processing system\n" +
          "Usage: sips [options] file ...\n" +
          "  -g, --getProperty <key>\n" +
          "  -s, --setProperty <key> <value>\n" +
          "  -Z, --resampleHeightWidthMax <size>\n" +
          "  -z, --resampleHeightWidth <height> <width>\n" +
          "  --resampleWidth <width>\n" +
          "  --resampleHeight <height>\n" +
          "  -c, --cropToHeightWidth <height> <width>\n" +
          "  --cropOffset <offsetY> <offsetX>\n" +
          "  -p, --padToHeightWidth <height> <width>\n" +
          "  --padColor <hexColor>\n" +
          "  -r, --rotate <degrees>\n" +
          "  -f, --flip horizontal|vertical\n" +
          "  -o, --out <file-or-directory>\n",
        stderr: ""
      };
    }
    if (arg === "-H" || arg === "--helpProperties") {
      return {
        exitCode: 0,
        stdout: ALL_SIPS_KEYS.join("\n") + "\nall\nallxml\n",
        stderr: ""
      };
    }
    if (arg === "-v" || arg === "--version") {
      return { exitCode: 0, stdout: "sips 10.4.4\n", stderr: "" };
    }
    if (arg === "--formats") {
      return {
        exitCode: 0,
        stdout:
          "Supported Formats:\n" +
          "-------------------------------------------\n" +
          "com.adobe.pdf                pdf   Writable\n" +
          "com.compuserve.gif           gif   Writable\n" +
          "com.microsoft.bmp            bmp   Writable\n" +
          "org.webmproject.webp         webp  Writable\n" +
          "public.avif                  avif  Writable\n" +
          "public.heic                  heic  Writable\n" +
          "public.heif                  heif  Writable\n" +
          "public.jpeg                  jpeg  Writable\n" +
          "public.png                   png   Writable\n" +
          "public.tiff                  tiff  Writable\n",
        stderr: ""
      };
    }
    if (arg === "-1" || arg === "--oneLine") {
      singleLine = true;
    } else if (arg === "-g" || arg === "--getProperty") {
      const key = argv[++i];
      if (!key) {
        return { exitCode: 1, stdout: "", stderr: "sips: missing argument for -g\n" };
      }
      getProperties.push(key);
    } else if (arg === "-s" || arg === "--setProperty") {
      const key = argv[++i];
      const val = argv[++i];
      if (!key || val === undefined) {
        return { exitCode: 1, stdout: "", stderr: "sips: missing argument for -s\n" };
      }
      if (key === "format") {
        const parsed = normalizeTargetFormat(val);
        if (!parsed) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `Error:Unsupported format: ${val}\n`
          };
        }
        targetFormat = parsed;
      } else if (key === "formatOptions") {
        formatOptionsStr = val;
      } else if (key === "dpiWidth") {
        const num = Number(val);
        if (Number.isFinite(num) && num > 0) {
          targetDpi = Math.round(num);
          customSetProps.set("dpiWidth", num.toFixed(3));
        }
      } else if (key === "dpiHeight") {
        const num = Number(val);
        if (Number.isFinite(num) && num > 0) {
          targetDpi = Math.round(num);
          customSetProps.set("dpiHeight", num.toFixed(3));
        }
      } else {
        customSetProps.set(key, val);
      }
      propertyMutated = true;
    } else if (arg === "-Z" || arg === "--resampleHeightWidthMax") {
      const maxDim = Number(argv[++i]);
      if (!Number.isFinite(maxDim) || maxDim <= 0) {
        return { exitCode: 1, stdout: "", stderr: "sips: invalid size for -Z\n" };
      }
      actions.push({ kind: "resampleMax", maxDim: Math.round(maxDim) });
    } else if (arg === "-z" || arg === "--resampleHeightWidth") {
      const h = Number(argv[++i]);
      const w = Number(argv[++i]);
      if (!Number.isFinite(h) || !Number.isFinite(w) || h <= 0 || w <= 0) {
        return { exitCode: 1, stdout: "", stderr: "sips: invalid dimensions for -z\n" };
      }
      actions.push({ kind: "resampleHW", height: Math.round(h), width: Math.round(w) });
    } else if (arg === "--resampleWidth") {
      const w = Number(argv[++i]);
      if (!Number.isFinite(w) || w <= 0) {
        return { exitCode: 1, stdout: "", stderr: "sips: invalid width for --resampleWidth\n" };
      }
      actions.push({ kind: "resampleW", width: Math.round(w) });
    } else if (arg === "--resampleHeight") {
      const h = Number(argv[++i]);
      if (!Number.isFinite(h) || h <= 0) {
        return { exitCode: 1, stdout: "", stderr: "sips: invalid height for --resampleHeight\n" };
      }
      actions.push({ kind: "resampleH", height: Math.round(h) });
    } else if (arg === "-c" || arg === "--cropToHeightWidth") {
      const h = Number(argv[++i]);
      const w = Number(argv[++i]);
      if (!Number.isFinite(h) || !Number.isFinite(w) || h <= 0 || w <= 0) {
        return { exitCode: 1, stdout: "", stderr: "sips: invalid dimensions for -c\n" };
      }
      actions.push({ kind: "crop", height: Math.round(h), width: Math.round(w) });
    } else if (arg === "--cropOffset") {
      const oy = Number(argv[++i]);
      const ox = Number(argv[++i]);
      if (!Number.isFinite(oy) || !Number.isFinite(ox)) {
        return { exitCode: 1, stdout: "", stderr: "sips: invalid offset for --cropOffset\n" };
      }
      cropOffsetY = Math.round(oy);
      cropOffsetX = Math.round(ox);
    } else if (arg === "-p" || arg === "--padToHeightWidth") {
      const h = Number(argv[++i]);
      const w = Number(argv[++i]);
      if (!Number.isFinite(h) || !Number.isFinite(w) || h <= 0 || w <= 0) {
        return { exitCode: 1, stdout: "", stderr: "sips: invalid dimensions for -p\n" };
      }
      actions.push({ kind: "pad", height: Math.round(h), width: Math.round(w) });
    } else if (arg === "--padColor") {
      padColor = argv[++i] ?? "000000";
    } else if (arg === "-r" || arg === "--rotate") {
      const deg = Number(argv[++i]);
      if (!Number.isFinite(deg)) {
        return { exitCode: 1, stdout: "", stderr: "sips: invalid degrees for -r\n" };
      }
      actions.push({ kind: "rotate", degrees: deg });
    } else if (arg === "-f" || arg === "--flip") {
      const dir = (argv[++i] ?? "").toLowerCase();
      if (dir !== "horizontal" && dir !== "vertical") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "sips: flip direction must be 'horizontal' or 'vertical'\n"
        };
      }
      actions.push({ kind: "flip", direction: dir });
    } else if (arg === "--verify") {
      verifyMode = true;
    } else if (arg === "-d" || arg === "--deleteProperty") {
      const key = argv[++i];
      if (!key) {
        return { exitCode: 1, stdout: "", stderr: "sips: missing argument for -d\n" };
      }
      customSetProps.set(key, null);
      propertyMutated = true;
    } else if (
      arg === "--deleteColorManagementProperties" ||
      arg === "--optimizeColorForSharing" ||
      arg === "-i" ||
      arg === "--addIcon" ||
      arg === "--repair" ||
      arg === "--debug"
    ) {
      if (arg === "--deleteColorManagementProperties") {
        customSetProps.set("profile", "sRGB IEC61966-2.1");
      }
      propertyMutated = true;
    } else if (arg === "-x" || arg === "--extractProfile") {
      const profile = argv[++i];
      if (!profile) {
        return { exitCode: 1, stdout: "", stderr: `sips: missing argument for ${arg}\n` };
      }
      verifyMode = true;
    } else if (
      arg === "-m" ||
      arg === "--matchTo" ||
      arg === "-e" ||
      arg === "--embedProfile" ||
      arg === "-E" ||
      arg === "--embedProfileIfNone" ||
      arg === "--deleteTag"
    ) {
      const profile = argv[++i];
      if (!profile) {
        return { exitCode: 1, stdout: "", stderr: `sips: missing argument for ${arg}\n` };
      }
      propertyMutated = true;
    } else if (
      arg === "-M" ||
      arg === "--matchToWithIntent" ||
      arg === "-X" ||
      arg === "--extractTag" ||
      arg === "--copyTag" ||
      arg === "--loadTag"
    ) {
      const profile = argv[++i];
      const intent = argv[++i];
      if (!profile || !intent) {
        return { exitCode: 1, stdout: "", stderr: `sips: missing arguments for ${arg}\n` };
      }
      propertyMutated = true;
    } else if (arg === "-o" || arg === "--out") {
      outTarget = argv[++i];
      if (!outTarget) {
        return { exitCode: 1, stdout: "", stderr: "sips: missing argument for --out\n" };
      }
    } else if (!arg.startsWith("-")) {
      inputPaths.push(arg);
    } else {
      return { exitCode: 1, stdout: "", stderr: `sips: unknown option: ${arg}\n` };
    }
  }

  if (inputPaths.length === 0) {
    return { exitCode: 1, stdout: "", stderr: "sips: no input files specified\n" };
  }

  const hasMutation =
    actions.length > 0 ||
    targetFormat !== undefined ||
    formatOptionsStr !== undefined ||
    targetDpi !== undefined ||
    propertyMutated ||
    outTarget !== undefined;

  const outLines: string[] = [];
  const errLines: string[] = [];
  let exitCode = 0;
  // Match macOS /usr/bin/sips slot precedence:
  // - If multiple crop/pad flags (-c / --padToHeightWidth) are supplied, only the final crop/pad flag applies.
  // - If both --resampleWidth and --resampleHeight are supplied separately, --resampleWidth takes precedence.
  const lastCropPadIdx = actions.reduce(
    (acc, act, idx) => (act.kind === "crop" || act.kind === "pad" ? idx : acc),
    -1
  );
  const hasResampleW = actions.some(act => act.kind === "resampleW");
  const filteredActions = actions.filter((act, idx) => {
    if ((act.kind === "crop" || act.kind === "pad") && idx !== lastCropPadIdx) {
      return false;
    }
    if (act.kind === "resampleH" && hasResampleW) {
      return false;
    }
    return true;
  });
  const isResample = (k: string) =>
    k === "resampleMax" || k === "resampleHW" || k === "resampleW" || k === "resampleH";
  const isRotFlip = (k: string) => k === "rotate" || k === "flip";
  const reversedRotFlips = filteredActions.filter(act => isRotFlip(act.kind)).reverse();
  const firstRotFlipIdx = filteredActions.findIndex(act => isRotFlip(act.kind));
  let effectiveActions: SipsAction[];
  if (firstRotFlipIdx === -1) {
    effectiveActions = [...filteredActions];
  } else {
    const beforeRotFlip = filteredActions.slice(0, firstRotFlipIdx);
    const nonResamplesBefore = beforeRotFlip.filter(act => !isResample(act.kind));
    const resamplesBefore = beforeRotFlip.filter(act => isResample(act.kind));
    const afterRotFlip = filteredActions.slice(firstRotFlipIdx).filter(act => !isRotFlip(act.kind));
    const resamplesAfter = afterRotFlip.filter(act => isResample(act.kind));
    const otherAfter = afterRotFlip.filter(act => !isResample(act.kind));
    effectiveActions = [
      ...nonResamplesBefore,
      ...resamplesAfter,
      ...reversedRotFlips,
      ...resamplesBefore,
      ...otherAfter
    ];
  }

  for (const inPath of inputPaths) {
    const inBytes = files.get(inPath);
    if (!inBytes) {
      errLines.push(`Error: ${inPath}: file does not exist`);
      exitCode = 1;
      continue;
    }

    try {
      const mergedProps = new Map<string, string | null>(SIPS_BUFFER_PROPS.get(inBytes) ?? []);
      for (const [k, v] of customSetProps) {
        mergedProps.set(k, v);
      }
      let inst: SharpInstance = sharp(inBytes);
      let meta = await inst.metadata();
      let curW = meta.width;
      let curH = meta.height;
      const origW = meta.width;
      const origH = meta.height;
      const effectivePadColor =
        padColor ?? (meta.hasAlpha ? { r: 0, g: 0, b: 0, alpha: 0 } : "000000");

      if (hasMutation) {
        for (const act of effectiveActions) {
          if (act.kind === "rotate") {
            inst = sharp(
              await inst.rotate(act.degrees, { background: effectivePadColor }).toBuffer()
            );
            meta = await inst.metadata();
            curW = meta.width;
            curH = meta.height;
          } else if (act.kind === "flip") {
            inst = sharp(
              await (act.direction === "horizontal" ? inst.flop() : inst.flip()).toBuffer()
            );
          } else if (act.kind === "resampleMax") {
            const scale = act.maxDim / Math.max(origW, origH, 1);
            const nw = Math.max(1, Math.round(curW * scale));
            const nh = Math.max(1, Math.round(curH * scale));
            inst = inst.resize(nw, nh, { fit: "fill" });
            curW = nw;
            curH = nh;
          } else if (act.kind === "resampleHW") {
            const scaleX = act.width / Math.max(1, origW);
            const scaleY = act.height / Math.max(1, origH);
            const nw = Math.max(1, Math.round(curW * scaleX));
            const nh = Math.max(1, Math.round(curH * scaleY));
            inst = inst.resize(nw, nh, { fit: "fill" });
            curW = nw;
            curH = nh;
          } else if (act.kind === "resampleW") {
            const scale = act.width / Math.max(1, origW);
            const nw = Math.max(1, Math.round(curW * scale));
            const nh = Math.max(1, Math.round(curH * scale));
            inst = inst.resize(nw, nh, { fit: "fill" });
            curW = nw;
            curH = nh;
          } else if (act.kind === "resampleH") {
            const scale = act.height / Math.max(1, origH);
            const nw = Math.max(1, Math.round(curW * scale));
            const nh = Math.max(1, Math.round(curH * scale));
            inst = inst.resize(nw, nh, { fit: "fill" });
            curW = nw;
            curH = nh;
          } else if (act.kind === "crop") {
            if (
              cropOffsetX === undefined &&
              cropOffsetY === undefined &&
              ((act.width - curW) % 2 !== 0 || (act.height - curH) % 2 !== 0)
            ) {
              inst = await applySipsOddCanvasCropOrPad(
                inst,
                curW,
                curH,
                act.width,
                act.height,
                effectivePadColor
              );
              curW = act.width;
              curH = act.height;
              continue;
            }
            const cw = Math.min(curW, act.width);
            const ch = Math.min(curH, act.height);
            const left =
              cropOffsetX !== undefined
                ? Math.max(0, Math.min(curW - cw, cropOffsetX))
                : Math.max(0, Math.floor((curW - cw) / 2));
            const top =
              cropOffsetY !== undefined
                ? Math.max(0, Math.min(curH - ch, cropOffsetY))
                : Math.max(0, Math.floor((curH - ch) / 2));
            inst = inst.extract({ left, top, width: cw, height: ch });
            curW = cw;
            curH = ch;
            if (act.width > curW || act.height > curH) {
              const padX = Math.max(0, act.width - curW);
              const padY = Math.max(0, act.height - curH);
              const padLeft = Math.floor(padX / 2);
              const padRight = padX - padLeft;
              const padTop = Math.floor(padY / 2);
              const padBottom = padY - padTop;
              inst = inst.extend({
                top: padTop,
                bottom: padBottom,
                left: padLeft,
                right: padRight,
                background: effectivePadColor
              });
              curW = act.width;
              curH = act.height;
            }
            inst = sharp(await inst.toBuffer());
          } else if (act.kind === "pad") {
            if ((act.width - curW) % 2 !== 0 || (act.height - curH) % 2 !== 0) {
              inst = await applySipsOddCanvasCropOrPad(
                inst,
                curW,
                curH,
                act.width,
                act.height,
                effectivePadColor
              );
              curW = act.width;
              curH = act.height;
              continue;
            }
            if (act.width < curW || act.height < curH) {
              const cw = Math.min(curW, act.width);
              const ch = Math.min(curH, act.height);
              const left = Math.max(0, Math.floor((curW - cw) / 2));
              const top = Math.max(0, Math.floor((curH - ch) / 2));
              inst = inst.extract({ left, top, width: cw, height: ch });
              curW = cw;
              curH = ch;
            }
            const padX = Math.max(0, act.width - curW);
            const padY = Math.max(0, act.height - curH);
            const left = Math.floor(padX / 2);
            const right = padX - left;
            const top = Math.floor(padY / 2);
            const bottom = padY - top;
            inst = inst.extend({
              top,
              bottom,
              left,
              right,
              background: effectivePadColor
            });
            curW = act.width;
            curH = act.height;
            inst = sharp(await inst.toBuffer());
          }
        }

        if (targetDpi !== undefined) {
          inst = inst.withMetadata({ density: targetDpi });
        }

        const outFmt =
          targetFormat ?? (meta.format === "pdf" || meta.format === "svg" ? "png" : meta.format);
        const quality = resolveQualityOption(formatOptionsStr);
        inst = inst.toFormat(outFmt, { quality });
        const outBytes = await inst.toBuffer();

        let finalOutPath = inPath;
        if (outTarget) {
          const normTarget = outTarget.endsWith("/") ? outTarget.slice(0, -1) : outTarget;
          let isExistingDir = false;
          for (const k of files.keys()) {
            if (k.startsWith(`${normTarget}/`)) {
              isExistingDir = true;
              break;
            }
          }
          if (inputPaths.length > 1 || outTarget.endsWith("/") || isExistingDir) {
            const rawBase = inPath.split("/").pop() ?? inPath;
            let base = rawBase;
            if (targetFormat) {
              const ext =
                targetFormat === "jpeg"
                  ? "jpg"
                  : targetFormat === "tiff"
                    ? "tif"
                    : targetFormat;
              const dotIdx = rawBase.lastIndexOf(".");
              base = dotIdx > 0 ? `${rawBase.slice(0, dotIdx)}.${ext}` : `${rawBase}.${ext}`;
            }
            const dir = outTarget.endsWith("/") ? outTarget.slice(0, -1) : outTarget;
            finalOutPath = `${dir}/${base}`;
          } else {
            finalOutPath = outTarget;
          }
        }
        files.set(finalOutPath, outBytes);
        if (mergedProps.size > 0) {
          SIPS_BUFFER_PROPS.set(outBytes, mergedProps);
        }
        meta = await sharp(outBytes).metadata();

        if (getProperties.length === 0) {
          outLines.push(inPath);
          outLines.push(`  ${finalOutPath}`);
        }
      }

      if (verifyMode && !hasMutation && getProperties.length === 0) {
        outLines.push(inPath);
      }
      if (getProperties.length > 0) {
        if (getProperties.includes("allxml")) {
          const xmlEntries = [
            ...ALL_SIPS_KEYS.map(k => {
              if (k === "pixelWidth" || k === "pixelHeight" || k === "samplesPerPixel" || k === "bitsPerSample") {
                const intVal = formatSipsPropertyValue(meta, k, mergedProps) ?? "0";
                return `  <key>${k}</key>\n  <integer>${intVal}</integer>`;
              }
              if (k === "dpiWidth" || k === "dpiHeight") {
                const dpiNum = Number(formatSipsPropertyValue(meta, k, mergedProps) ?? meta.density ?? 72);
                const dpiStr = Number.isInteger(dpiNum) ? String(dpiNum) : dpiNum.toFixed(3);
                return `  <key>${k}</key>\n  <real>${dpiStr}</real>`;
              }
              if (k === "hasAlpha") {
                return `  <key>${k}</key>\n  <${meta.hasAlpha ? "true" : "false"}/>`;
              }
              const val = formatSipsPropertyValue(meta, k, mergedProps) ?? "";
              return `  <key>${k}</key>\n  <string>${val}</string>`;
            }),
            `  <key>path</key>\n  <string>${inPath}</string>`
          ].join("\n");
          outLines.push(
            `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${xmlEntries}\n</dict>\n</plist>`
          );
        } else {
          const expandedKeys: string[] = [];
          for (const k of getProperties) {
            if (k === "all") expandedKeys.push(...ALL_SIPS_KEYS);
            else expandedKeys.push(k);
          }
          const propLines: string[] = [inPath];
          for (const k of expandedKeys) {
            const val = formatSipsPropertyValue(meta, k, mergedProps);
            if (val !== undefined) {
              propLines.push(singleLine ? `${k}: ${val}` : `  ${k}: ${val}`);
            } else {
              propLines.push(singleLine ? `${k}: <nil>` : `  ${k}: <nil>`);
            }
          }
          if (singleLine) {
            outLines.push(propLines.join("|") + "|");
          } else {
            outLines.push(...propLines);
          }
        }
      }
    } catch (err) {
      errLines.push(`Error: ${inPath}: ${(err as Error).message}`);
      exitCode = 1;
    }
  }

  return {
    exitCode,
    stdout: outLines.length > 0 ? outLines.join("\n") + "\n" : "",
    stderr: errLines.length > 0 ? errLines.join("\n") + "\n" : ""
  };
}

function formatIdentifyCustom(fmt: string, filePath: string, meta: ImageMetadata, byteSize: number): string {
  const lastSlash = filePath.lastIndexOf("/");
  const dirName = lastSlash > 0 ? filePath.slice(0, lastSlash) : lastSlash === 0 ? "/" : ".";
  const fileName = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
  const dotIdx = fileName.lastIndexOf(".");
  const basename = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
  const ext = dotIdx > 0 ? fileName.slice(dotIdx + 1) : "";
  const bitDepth = meta.depth === "ushort" ? "16" : meta.depth === "bit" ? "1" : "8";
  const spaceLabel = meta.space === "b-w" ? "Gray" : meta.space === "cmyk" ? "CMYK" : "sRGB";

  let out = "";
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i]!;
    if (c === "\\" && i + 1 < fmt.length) {
      const next = fmt[++i]!;
      if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else if (next === "r") out += "\r";
      else out += next;
    } else if (c === "%" && i + 1 < fmt.length) {
      if (fmt[i + 1] === "[") {
        const closeIdx = fmt.indexOf("]", i + 2);
        if (closeIdx !== -1) {
          const expr = fmt.slice(i + 2, closeIdx).toLowerCase();
          i = closeIdx;
          switch (expr) {
            case "width":
            case "fx:w":
              out += String(meta.width);
              break;
            case "height":
            case "fx:h":
              out += String(meta.height);
              break;
            case "channels":
              out += String(meta.channels);
              break;
            case "colorspace":
              out += spaceLabel;
              break;
            case "bit-depth":
            case "depth":
              out += bitDepth;
              break;
            case "orientation":
              out += String(meta.orientation ?? 1);
              break;
            case "size":
              out += `${byteSize}B`;
              break;
            case "format":
              out += meta.format.toUpperCase();
              break;
            case "alpha":
              out += String(meta.hasAlpha);
              break;
            case "type":
              out +=
                meta.space === "b-w"
                  ? meta.hasAlpha
                    ? "GrayscaleAlpha"
                    : "Grayscale"
                  : meta.hasAlpha
                    ? "TrueColorAlpha"
                    : "TrueColor";
              break;
            case "resolution.x":
            case "resolution.y":
              out += String(meta.density ?? 72);
              break;
            default:
              if (expr.startsWith("fx:")) {
                const fxExpr = expr.slice(3).trim();
                if (fxExpr === "w*h" || fxExpr === "h*w") {
                  out += String(meta.width * meta.height);
                } else if (fxExpr === "w/h") {
                  out += String(meta.width / meta.height);
                } else if (fxExpr === "w+h" || fxExpr === "h+w") {
                  out += String(meta.width + meta.height);
                } else if (fxExpr === "w-h") {
                  out += String(meta.width - meta.height);
                } else if (fxExpr === "max(w,h)" || fxExpr === "max(h,w)") {
                  out += String(Math.max(meta.width, meta.height));
                } else if (fxExpr === "min(w,h)" || fxExpr === "min(h,w)") {
                  out += String(Math.min(meta.width, meta.height));
                } else if (fxExpr === "w/2") {
                  out += String(meta.width / 2);
                } else if (fxExpr === "h/2") {
                  out += String(meta.height / 2);
                } else {
                  out += "";
                }
                break;
              }
              out += "";
              break;
          }
          continue;
        }
      }
      const spec = fmt[++i]!;
      switch (spec) {
        case "%":
          out += "%";
          break;
        case "w":
          out += String(meta.width);
          break;
        case "h":
          out += String(meta.height);
          break;
        case "m":
          out += meta.format.toUpperCase();
          break;
        case "z":
        case "q":
          out += bitDepth;
          break;
        case "k":
          out += String(meta.channels);
          break;
        case "r":
          out += `DirectClass ${spaceLabel}`;
          break;
        case "b":
          out += `${byteSize}B`;
          break;
        case "B":
          out += String(byteSize);
          break;
        case "C": {
          const comp =
            meta.format === "png"
              ? "Zip"
              : meta.format === "jpeg"
                ? "JPEG"
                : meta.format === "webp"
                  ? "WebP"
                  : meta.format === "gif" || meta.format === "tiff"
                    ? "LZW"
                    : meta.format === "heic" || meta.format === "heif"
                      ? "HEVC"
                      : meta.format === "avif"
                        ? "AV1"
                        : "None";
          out += comp;
          break;
        }
        case "d":
          out += dirName;
          break;
        case "f":
          out += fileName;
          break;
        case "i":
          out += filePath;
          break;
        case "n":
          out += String(meta.pages ?? 1);
          break;
        case "p":
          out += String(meta.pagePrimary ?? 0);
          break;
        case "t":
          out += basename;
          break;
        case "e":
          out += ext;
          break;
        case "g":
          out += `${meta.width}x${meta.height}+0+0`;
          break;
        case "G":
        case "P":
          out += `${meta.width}x${meta.height}`;
          break;
        case "W":
          out += String(meta.width);
          break;
        case "H":
          out += String(meta.height);
          break;
        case "X":
        case "Y":
          out += "+0";
          break;
        case "U":
          out += "PixelsPerInch";
          break;
        case "A":
          out += meta.hasAlpha ? "Blend" : "Undefined";
          break;
        case "x":
        case "y":
          out += String(meta.density ?? 72);
          break;
        case "Q":
          out += "85";
          break;
        default:
          out += `%${spec}`;
          break;
      }
    } else {
      out += c;
    }
  }
  return out;
}

export async function runIdentifyCli(
  argv: readonly string[],
  files: Map<string, Uint8Array>
): Promise<SipsCliResult> {
  let customFormat: string | undefined;
  let verbose = false;
  const inputPaths: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "-help" || arg === "--help") {
      return {
        exitCode: 0,
        stdout:
          "Usage: identify [options] input-file ...\n" +
          "  -ping\n" +
          "  -format <string>\n" +
          "  -verbose\n",
        stderr: ""
      };
    }
    if (arg === "-version" || arg === "--version") {
      return { exitCode: 0, stdout: "Version: ImageMagick 7.1.1-38 (safe-bash image-ast)\n", stderr: "" };
    }
    if (arg === "-ping" || arg === "-quiet") {
      // metadata-only mode (default unless -verbose)
    } else if (arg === "-verbose") {
      verbose = true;
    } else if (arg === "-format") {
      customFormat = argv[++i] ?? "";
    } else if (!arg.startsWith("-")) {
      inputPaths.push(arg);
    }
  }

  if (inputPaths.length === 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "identify: missing an image filename\n"
    };
  }

  const outParts: string[] = [];
  const errParts: string[] = [];
  let exitCode = 0;

  for (const inPath of inputPaths) {
    const bracketMatch = /^(.*)\[(\d+)\]$/.exec(inPath);
    const baseInPath = bracketMatch ? bracketMatch[1]! : inPath;
    const pageIdx = bracketMatch ? parseInt(bracketMatch[2]!, 10) : undefined;
    const bytes = files.get(inPath) ?? files.get(baseInPath);
    if (!bytes) {
      errParts.push(`identify: unable to open image '${inPath}': No such file or directory\n`);
      exitCode = 1;
      continue;
    }
    try {
      const inst = sharp(bytes, pageIdx !== undefined ? { page: pageIdx } : undefined);
      const meta = await inst.metadata();
      const bitDepth = meta.depth === "ushort" ? "16" : meta.depth === "bit" ? "1" : "8";
      const spaceLabel = meta.space === "b-w" ? "Gray" : meta.space === "cmyk" ? "CMYK" : "sRGB";

      if (customFormat !== undefined) {
        outParts.push(formatIdentifyCustom(customFormat, baseInPath, meta, bytes.byteLength));
      } else if (verbose) {
        const stats = await inst.stats();
        outParts.push(
          `Image: ${inPath}\n` +
            `  Format: ${meta.format.toUpperCase()}\n` +
            `  Geometry: ${meta.width}x${meta.height}+0+0\n` +
            `  Resolution: ${meta.density}x${meta.density}\n` +
            `  Colorspace: ${spaceLabel}\n` +
            `  Depth: ${bitDepth}-bit\n` +
            `  Channels: ${meta.channels}\n` +
            `  Alpha: ${meta.hasAlpha ? "True" : "False"}\n` +
            `  Filesize: ${bytes.byteLength}B\n` +
            `  Entropy: ${stats.entropy.toFixed(4)}\n`
        );
      } else {
        outParts.push(
          `${inPath} ${meta.format.toUpperCase()} ${meta.width}x${meta.height} ${meta.width}x${meta.height}+0+0 ${bitDepth}-bit ${spaceLabel} ${bytes.byteLength}B 0.000u 0:00.000\n`
        );
      }
    } catch (err) {
      errParts.push(`identify: improper image header '${inPath}': ${(err as Error).message}\n`);
      exitCode = 1;
    }
  }

  return {
    exitCode,
    stdout: outParts.join(""),
    stderr: errParts.join("")
  };
}

async function executeVfsImageTool(
  context: CommandContext,
  runner: (argv: readonly string[], files: Map<string, Uint8Array>) => Promise<SipsCliResult>
): Promise<{ exitCode: number }> {
  const invocation = createOutputOperation(context, { write: async () => {} });
  try {
    const carrier = getCommandArguments(context);
    const argv = [...carrier.args];
    const vfsFiles = new Map<string, Uint8Array>();
    const resolveVfsPath = (p: string) =>
      p.startsWith("/") ? p : `${context.cwd === "/" ? "" : context.cwd}/${p}`;

    const normalizedArgv = [...argv];
    for (let i = 0; i < normalizedArgv.length; i++) {
      const token = normalizedArgv[i]!;
      if (token === "-o" || token === "--out") {
        const next = normalizedArgv[i + 1];
        if (next && !next.endsWith("/")) {
          try {
            const st = await context.fs.stat(resolveVfsPath(next), { signal: invocation.signal });
            if (st.type === "directory") {
              normalizedArgv[i + 1] = next + "/";
            }
          } catch {
            // Target does not exist yet
          }
        }
        continue;
      }
      if (token.startsWith("-")) continue;
      const bracketMatch = /^(.*)\[(\d+)\]$/.exec(token);
      const fileToken = bracketMatch ? bracketMatch[1]! : token;
      try {
        const bytes = await context.fs.readFile(resolveVfsPath(fileToken), {
          signal: invocation.signal
        });
        vfsFiles.set(fileToken, bytes);
      } catch {
        // Output path or non-existent file
      }
    }

    const existingSnap = new Map(vfsFiles);
    const res = await runner(normalizedArgv, vfsFiles);

    if (res.stderr) {
      await writeBytes(context.stderr, new TextEncoder().encode(res.stderr), invocation.signal);
    }
    if (res.stdout) {
      const stdout = invocation.child(context.stdout);
      await writeBytes(stdout.output, new TextEncoder().encode(res.stdout), invocation.signal);
    }

    for (const [key, val] of vfsFiles.entries()) {
      if (existingSnap.get(key) !== val) {
        const abs = resolveVfsPath(key);
        const parentDir = abs.slice(0, abs.lastIndexOf("/")) || "/";
        try {
          await context.fs.mkdir(parentDir, { recursive: true, signal: invocation.signal });
        } catch {
          // Directory already exists
        }
        await context.fs.writeFile(abs, val, { signal: invocation.signal });
      }
    }
    return { exitCode: res.exitCode };
  } finally {
    await invocation.close();
  }
}

export function createSipsCommand(_options: SipsCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "sips",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Scriptable image processing system powered by @poe-code/image-ast",
    execute(context: CommandContext) {
      return executeVfsImageTool(context, runSipsCli);
    }
  });
}

export const sipsCommand: CommandDefinition = createSipsCommand();

export function createIdentifyCommand(_options: SipsCommandOptions = {}): CommandDefinition {
  return Object.freeze({
    name: "identify",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Inspect image format, dimensions, and metadata via @poe-code/image-ast",
    execute(context: CommandContext) {
      return executeVfsImageTool(context, runIdentifyCli);
    }
  });
}

export const identifyCommand: CommandDefinition = createIdentifyCommand();

export function sipsPlugin(options: SipsCommandOptions = {}): VirtualShellPlugin {
  const sips = createSipsCommand(options);
  const identify = createIdentifyCommand(options);
  const replace = options.replace ?? false;
  return {
    name: "sips",
    setup(host) {
      host.commands.register(sips, { replace });
      host.commands.register(identify, { replace });
    }
  };
}

export const sipsCommands = sipsPlugin;
