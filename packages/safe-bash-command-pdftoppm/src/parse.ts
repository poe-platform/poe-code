import type { PdftoppmCliResult } from "./index.js";
export const VALUE_FLAGS = new Set([
  "-r",
  "-rx",
  "-ry",
  "-scale-to",
  "-scale-to-x",
  "-scale-to-y",
  "-f",
  "-l",
  "-x",
  "-y",
  "-W",
  "-H",
  "-sz",
  "-sep",
  "-setpageno",
  "-defaultgray",
  "-defaultrgb",
  "-defaultcmyk",
  "-upw",
  "-opw",
  "-tiffcompression",
  "-aa",
  "-aaVector",
  "-thinlinemode",
  "-freetype",
  "-jpegopt",
]);

const INTEGER_FLAGS = new Set(["-scale-to", "-scale-to-x", "-scale-to-y", "-f", "-l", "-x", "-y", "-W", "-H", "-sz", "-setpageno"]);
const RESOLUTION_FLAGS = new Set(["-r", "-rx", "-ry"]);

export interface PdftoppmPlan {
  readonly format: "ppm" | "pgm" | "pbm" | "png" | "svg" | "jpg" | "tif";
  readonly colorMode: "rgb" | "gray" | "mono";
  readonly dpi: number;
  readonly dpiX: number | undefined;
  readonly dpiY: number | undefined;
  readonly scaleTo: number;
  readonly scaleToX: number;
  readonly scaleToY: number;
  readonly firstPage: number;
  readonly lastPage: number;
  readonly oddOnly: boolean;
  readonly evenOnly: boolean;
  readonly singleFile: boolean;
  readonly forceNum: boolean;
  readonly sep: string;
  readonly setPageNo: number | undefined;
  readonly cropX: number;
  readonly cropY: number;
  readonly cropW: number;
  readonly cropH: number;
  readonly hasCrop: boolean;
  readonly useCropBox: boolean;
  readonly hideAnnotations: boolean;
  readonly transparent: boolean;
  readonly progress: boolean;
  readonly quiet: boolean;
  readonly jpegQuality: number;
  readonly tiffCompression: "none" | "packbits" | "deflate" | "lzw" | "jpeg";
  readonly antialiasText: boolean;
  readonly antialiasVector: boolean;
  readonly thinLineMode: "none" | "solid" | "shape";
  readonly password: string;
  readonly positionals: string[];
  readonly inputPath: string;
}

export function* parsePdftoppmArgsSteps(argv: readonly string[], hasStdin: boolean): Generator<void, PdftoppmPlan | PdftoppmCliResult, void> {
    let cooperativeWork = 63;
    let format: "ppm" | "pgm" | "pbm" | "png" | "svg" | "jpg" | "tif" = "ppm";
    let explicitContainer: "png" | "tif" | "jpg" | "svg" | undefined;
    let colorMode: "rgb" | "gray" | "mono" = "rgb";
    let dpi = 150;
    let dpiX: number | undefined;
    let dpiY: number | undefined;
    let scaleTo = 0;
    let scaleToX = 0;
    let scaleToY = 0;
    let firstPage = 1;
    let lastPage = 0;
    let oddOnly = false;
    let evenOnly = false;
    let singleFile = false;
    let forceNum = false;
    let sep = "-";
    let setPageNo: number | undefined;
    let cropX = 0;
    let cropY = 0;
    let cropW = 0;
    let cropH = 0;
    let hasCrop = false;
    let useCropBox = false;
    let hideAnnotations = false;
    let transparent = false;
    let progress = false;
    let quiet = false;
    let jpegQuality = 90;
    let tiffCompression: "none" | "packbits" | "deflate" | "lzw" | "jpeg" = "none";
    let antialiasText = true;
    let antialiasVector = true;
    let thinLineMode: "none" | "solid" | "shape" = "none";
    let password = "";
    const positionals: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (++cooperativeWork % 64 === 0)
            yield;
        const arg = argv[i]!;
        if (arg === "--") {
            positionals.push(...argv.slice(i + 1));
            break;
        }
        if (VALUE_FLAGS.has(arg)) {
            const value = argv[i + 1];
            if (value === undefined) {
                return { exitCode: 99, stdout: "", stderr: `Missing value for '${arg}'\n` };
            }
            const integer = INTEGER_FLAGS.has(arg);
            const resolution = RESOLUTION_FLAGS.has(arg);
            if (integer || resolution) {
                const unsigned = value.startsWith("+") || value.startsWith("-") ? value.slice(1) : value;
                const validInteger = [...unsigned].every(char => char >= "0" && char <= "9");
                const validResolution = [...unsigned].every(char => "0123456789.eE+-".includes(char))
                    && (Number.isFinite(Number(value)) || unsigned === "" || unsigned === ".");
                if (integer ? !validInteger : !validResolution) {
                    return { exitCode: 99, stdout: "", stderr: `Bad '${arg}' value on command line\n` };
                }
            }
        }
        if (arg === "-v" || arg === "--version") {
            return { exitCode: 0, stdout: "pdftoppm version 24.08.0\n", stderr: "" };
        }
        if (arg === "-h" || arg === "-help" || arg === "--help" || arg === "-?") {
            return {
                exitCode: 0,
                stdout: "Usage: pdftoppm [options] [PDF-file [PPM-root]]\n  -png / -gray / -mono / -svg / -r <fp> / -rx <fp> / -ry <fp> / -f <int> / -l <int> / -singlefile / -x <int> / -y <int> / -W <int> / -H <int> / -cropbox\n",
                stderr: "",
            };
        }
        if (arg === "-png") {
            format = "png";
            explicitContainer = "png";
        }
        else if (arg === "-tiff") {
            format = "tif";
            explicitContainer = "tif";
        }
        else if (arg === "-jpeg" || arg === "-jpg" || arg === "-jpegcmyk") {
            format = "jpg";
            explicitContainer = "jpg";
        }
        else if (arg === "-gray") {
            colorMode = "gray";
            if (!explicitContainer)
                format = "pgm";
        }
        else if (arg === "-mono") {
            colorMode = "mono";
            if (!explicitContainer)
                format = "pbm";
        }
        else if (arg === "-svg") {
            format = "svg";
            explicitContainer = "svg";
        }
        else if (arg === "-ppm")
            format = "ppm";
        else if (arg === "-singlefile")
            singleFile = true;
        else if (arg === "-forcenum")
            forceNum = true;
        else if (arg === "-o" || arg === "-odd")
            oddOnly = true;
        else if (arg === "-e" || arg === "-even")
            evenOnly = true;
        else if (arg === "-cropbox")
            useCropBox = true;
        else if (arg === "-hide-annotations")
            hideAnnotations = true;
        else if (arg === "-transp")
            transparent = true;
        else if (arg === "-overprint") {
            // Accepted for Poppler CLI compatibility
        }
        else if (arg === "-progress")
            progress = true;
        else if (arg === "-q")
            quiet = true;
        else if (arg === "-jpegopt") {
            const optStr = argv[++i] ?? "";
            for (const part of optStr.split(",")) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                const eqIdx = part.indexOf("=");
                if (eqIdx > 0 && part.slice(0, eqIdx).trim().toLowerCase() === "quality") {
                    const qVal = Number(part.slice(eqIdx + 1).trim());
                    if (Number.isFinite(qVal) && qVal >= 1 && qVal <= 100) {
                        jpegQuality = Math.round(qVal);
                    }
                }
            }
        }
        else if (arg === "-tiffcompression") {
            const comp = (argv[++i] ?? "").toLowerCase();
            if (comp === "none" ||
                comp === "packbits" ||
                comp === "deflate" ||
                comp === "lzw" ||
                comp === "jpeg") {
                tiffCompression = comp;
            }
            else {
                return {
                    exitCode: 99,
                    stdout: "",
                    stderr: quiet ? "" : `Bad '-tiffcompression' value on command line\n`,
                };
            }
        }
        else if (arg === "-aa") {
            const v = (argv[++i] ?? "").toLowerCase();
            if (v === "yes")
                antialiasText = true;
            else if (v === "no")
                antialiasText = false;
            else {
                return { exitCode: 99, stdout: "", stderr: quiet ? "" : `Bad '-aa' value on command line\n` };
            }
        }
        else if (arg === "-aaVector") {
            const v = (argv[++i] ?? "").toLowerCase();
            if (v === "yes")
                antialiasVector = true;
            else if (v === "no")
                antialiasVector = false;
            else {
                return { exitCode: 99, stdout: "", stderr: quiet ? "" : `Bad '-aaVector' value on command line\n` };
            }
        }
        else if (arg === "-thinlinemode") {
            const v = (argv[++i] ?? "").toLowerCase();
            if (v === "none" || v === "solid" || v === "shape")
                thinLineMode = v;
            else {
                return { exitCode: 99, stdout: "", stderr: quiet ? "" : `Bad '-thinlinemode' value on command line\n` };
            }
        }
        else if (arg === "-freetype" ||
            arg === "-defaultgray" ||
            arg === "-defaultrgb" ||
            arg === "-defaultcmyk") {
            i++;
        }
        else if (arg === "-setpageno") {
            const n = Number.parseInt(argv[++i] ?? "", 10);
            if (Number.isFinite(n))
                setPageNo = n;
        }
        else if (arg === "-sep") {
            sep = argv[++i] ?? "-";
        }
        else if (arg === "-r") {
            dpi = Math.max(1, Number(argv[++i] ?? "150") || 150);
        }
        else if (arg === "-rx") {
            dpiX = Math.max(1, Number(argv[++i] ?? "150") || 150);
        }
        else if (arg === "-ry") {
            dpiY = Math.max(1, Number(argv[++i] ?? "150") || 150);
        }
        else if (arg === "-scale-to") {
            scaleTo = Math.max(0, Number(argv[++i] ?? "0") || 0);
        }
        else if (arg === "-scale-to-x") {
            scaleToX = Number(argv[++i] ?? "0") || 0;
        }
        else if (arg === "-scale-to-y") {
            scaleToY = Number(argv[++i] ?? "0") || 0;
        }
        else if (arg === "-f") {
            firstPage = Math.max(1, Number.parseInt(argv[++i] ?? "1", 10) || 1);
        }
        else if (arg === "-l") {
            lastPage = Math.max(0, Number.parseInt(argv[++i] ?? "0", 10) || 0);
        }
        else if (arg === "-x") {
            cropX = Math.max(0, Number.parseInt(argv[++i] ?? "0", 10) || 0);
            hasCrop = true;
        }
        else if (arg === "-y") {
            cropY = Math.max(0, Number.parseInt(argv[++i] ?? "0", 10) || 0);
            hasCrop = true;
        }
        else if (arg === "-W") {
            cropW = Math.max(0, Number.parseInt(argv[++i] ?? "0", 10) || 0);
            hasCrop = true;
        }
        else if (arg === "-H") {
            cropH = Math.max(0, Number.parseInt(argv[++i] ?? "0", 10) || 0);
            hasCrop = true;
        }
        else if (arg === "-sz") {
            const sz = Math.max(0, Number.parseInt(argv[++i] ?? "0", 10) || 0);
            cropW = sz;
            cropH = sz;
            hasCrop = true;
        }
        else if (arg === "-upw" || arg === "-opw") {
            password = argv[++i] ?? "";
        }
        else if (!arg.startsWith("-") || arg === "-") {
            positionals.push(arg);
        }
        else {
            return { exitCode: 99, stdout: "", stderr: `Unknown option '${arg}'\n` };
        }
    }
    const inputPath = positionals[0] ?? (hasStdin ? "-" : undefined);
    if (!inputPath || positionals.length > 2) {
        return { exitCode: 99, stdout: "", stderr: "Usage: pdftoppm [options] [PDF-file [PPM-root]]\n" };
    }
    return { format, colorMode, dpi, dpiX, dpiY, scaleTo, scaleToX, scaleToY, firstPage, lastPage, oddOnly, evenOnly, singleFile, forceNum, sep, setPageNo, cropX, cropY, cropW, cropH, hasCrop, useCropBox, hideAnnotations, transparent, progress, quiet, jpegQuality, tiffCompression, antialiasText, antialiasVector, thinLineMode, password, positionals, inputPath };
}

const VALID_CAIRO_ANTIALIAS = new Set([
  "default",
  "none",
  "gray",
  "subpixel",
  "fast",
  "good",
  "best",
]);

export const CAIRO_VALUE_FLAGS = new Set([
  ...VALUE_FLAGS,
  "-antialias",
  "-icc",
  "-paper",
  "-paperw",
  "-paperh",
]);

export interface PdftocairoPlan {
  readonly format: "png" | "jpg" | "tif" | "svg" | "pdf" | "ps" | "eps";
  readonly grayMode: boolean;
  readonly monoMode: boolean;
  readonly quiet: boolean;
  readonly firstPage: number;
  readonly lastPage: number;
  readonly oddOnly: boolean;
  readonly evenOnly: boolean;
  readonly cropX: number;
  readonly cropY: number;
  readonly cropW: number;
  readonly cropH: number;
  readonly hasCrop: boolean;
  readonly paperW: number;
  readonly paperH: number;
  readonly origPageSizes: boolean;
  readonly password: string;
  readonly forwardedArgs: string[];
  readonly positionals: string[];
  readonly inputPath: string;
}

export function* parsePdftocairoArgsSteps(argv: readonly string[], hasStdin: boolean): Generator<void, PdftocairoPlan | PdftoppmCliResult, void> {
    let cooperativeWork = 63;
    let format: "png" | "jpg" | "tif" | "svg" | "pdf" | "ps" | "eps" = "png";
    let grayMode = false;
    let monoMode = false;
    let quiet = false;
    let firstPage = 1;
    let lastPage = 0;
    let oddOnly = false;
    let evenOnly = false;
    let cropX = 0;
    let cropY = 0;
    let cropW = 0;
    let cropH = 0;
    let hasCrop = false;
    let paperW = 0;
    let paperH = 0;
    let origPageSizes = false;
    let password = "";
    const forwardedArgs: string[] = [];
    const positionals: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (++cooperativeWork % 64 === 0)
            yield;
        const arg = argv[i]!;
        if (arg === "--") {
            positionals.push(...argv.slice(i + 1));
            break;
        }
        if (arg === "-v" || arg === "--version") {
            return { exitCode: 0, stdout: "pdftocairo version 24.08.0\n", stderr: "" };
        }
        if (arg === "-h" || arg === "-help" || arg === "--help" || arg === "-?") {
            return {
                exitCode: 0,
                stdout: "Usage: pdftocairo [options] <PDF-file> [<output-file>]\n  -png / -jpeg / -tiff / -ps / -eps / -pdf / -svg\n",
                stderr: "",
            };
        }
        if (arg === "-png") {
            format = "png";
            forwardedArgs.push("-png");
        }
        else if (arg === "-jpeg" || arg === "-jpg") {
            format = "jpg";
            forwardedArgs.push("-jpeg");
        }
        else if (arg === "-tiff") {
            format = "tif";
            forwardedArgs.push("-tiff");
        }
        else if (arg === "-svg") {
            format = "svg";
        }
        else if (arg === "-pdf") {
            format = "pdf";
        }
        else if (arg === "-ps") {
            format = "ps";
        }
        else if (arg === "-eps") {
            format = "eps";
        }
        else if (arg === "-gray") {
            grayMode = true;
        }
        else if (arg === "-mono") {
            monoMode = true;
        }
        else if (arg === "-q") {
            quiet = true;
            forwardedArgs.push("-q");
        }
        else if (arg === "-antialias") {
            const mode = (argv[++i] ?? "").toLowerCase();
            if (!VALID_CAIRO_ANTIALIAS.has(mode)) {
                return {
                    exitCode: 99,
                    stdout: "",
                    stderr: quiet ? "" : `Bad '-antialias' value on command line\n`,
                };
            }
            if (mode === "none") {
                forwardedArgs.push("-aa", "no", "-aaVector", "no");
            }
            else {
                forwardedArgs.push("-aa", "yes", "-aaVector", "yes");
            }
        }
        else if (arg === "-icc") {
            i++;
        }
        else if (arg === "-paper") {
            const pName = (argv[++i] ?? "").toLowerCase();
            if (pName === "letter") {
                paperW = 612;
                paperH = 792;
            }
            else if (pName === "legal") {
                paperW = 612;
                paperH = 1008;
            }
            else if (pName === "a3") {
                paperW = 842;
                paperH = 1191;
            }
            else if (pName === "a4") {
                paperW = 595;
                paperH = 842;
            }
            else if (pName === "a5") {
                paperW = 420;
                paperH = 595;
            }
        }
        else if (arg === "-paperw") {
            paperW = Math.max(1, Number.parseInt(argv[++i] ?? "0", 10) || 0);
        }
        else if (arg === "-paperh") {
            paperH = Math.max(1, Number.parseInt(argv[++i] ?? "0", 10) || 0);
        }
        else if (arg === "-origpagesizes") {
            origPageSizes = true;
        }
        else if (arg === "-level2" ||
            arg === "-level3" ||
            arg === "-nocrop" ||
            arg === "-expand" ||
            arg === "-noshrink" ||
            arg === "-nocenter" ||
            arg === "-duplex") {
            // Standard pdftocairo vector/print flags
        }
        else if (VALUE_FLAGS.has(arg)) {
            const val = argv[++i] ?? "";
            forwardedArgs.push(arg, val);
            if (arg === "-f")
                firstPage = Math.max(1, Number.parseInt(val, 10) || 1);
            else if (arg === "-l")
                lastPage = Math.max(0, Number.parseInt(val, 10) || 0);
            else if (arg === "-x") {
                cropX = Math.max(0, Number.parseInt(val, 10) || 0);
                hasCrop = true;
            }
            else if (arg === "-y") {
                cropY = Math.max(0, Number.parseInt(val, 10) || 0);
                hasCrop = true;
            }
            else if (arg === "-W") {
                cropW = Math.max(0, Number.parseInt(val, 10) || 0);
                hasCrop = true;
            }
            else if (arg === "-H") {
                cropH = Math.max(0, Number.parseInt(val, 10) || 0);
                hasCrop = true;
            }
            else if (arg === "-sz") {
                const sz = Math.max(0, Number.parseInt(val, 10) || 0);
                cropW = sz;
                cropH = sz;
                hasCrop = true;
            }
            else if (arg === "-upw" || arg === "-opw") {
                password = val;
            }
        }
        else if (arg.startsWith("-") && arg !== "-") {
            if (arg === "-o")
                oddOnly = true;
            if (arg === "-e")
                evenOnly = true;
            forwardedArgs.push(arg);
        }
        else {
            positionals.push(arg);
        }
    }
    const inputPath = positionals[0] ?? (hasStdin ? "-" : undefined);
    if (!inputPath) {
        return { exitCode: 99, stdout: "", stderr: "Usage: pdftocairo [options] <PDF-file> [<output-file>]\n" };
    }
    return { format, grayMode, monoMode, quiet, firstPage, lastPage, oddOnly, evenOnly, cropX, cropY, cropW, cropH, hasCrop, paperW, paperH, origPageSizes, password, forwardedArgs, positionals, inputPath };
}
