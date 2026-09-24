import {
  MermaidError,
  type MermaidThemeMode
} from "./contracts.js";

export type MmdcOutputFormat = "svg" | "png";

export interface MmdcParsedArguments {
  readonly action: "render" | "help" | "version";
  readonly input: string;
  readonly output: string;
  readonly outputFormat: MmdcOutputFormat;
  readonly theme: MermaidThemeMode | undefined;
  readonly width: number | undefined;
  readonly height: number | undefined;
  readonly scale: number | undefined;
  readonly svgId: string | undefined;
  readonly backgroundColor: string | undefined;
  readonly configFile: string | undefined;
  readonly quiet: boolean;
}

const FORBIDDEN_FLAGS = new Set([
  "-p",
  "--puppeteerConfigFile",
  "-C",
  "--cssFile",
  "-f",
  "--pdfFit",
  "--iconPacks",
  "--iconPacksNamesAndUrls"
]);

function inferFormatFromPath(outputPath: string, explicitFormat?: string): MmdcOutputFormat {
  let normalizedExplicit: MmdcOutputFormat | undefined;
  if (explicitFormat !== undefined) {
    const lower = explicitFormat.trim().toLowerCase();
    if (lower !== "svg" && lower !== "png") {
      throw new MermaidError(
        "E_ARGUMENT",
        `Unsupported output format '${explicitFormat}'. Supported formats: svg, png`
      );
    }
    normalizedExplicit = lower;
  }

  if (outputPath === "-") {
    return normalizedExplicit ?? "svg";
  }

  const lastDot = outputPath.lastIndexOf(".");
  const lastSlash = outputPath.lastIndexOf("/");
  if (lastDot > lastSlash && lastDot < outputPath.length - 1) {
    const ext = outputPath.slice(lastDot + 1).toLowerCase();
    if (ext === "svg" || ext === "png") {
      return normalizedExplicit ?? ext;
    }
    throw new MermaidError(
      "E_ARGUMENT",
      `Unsupported output extension '.${ext}'. Supported extensions: .svg, .png`
    );
  }

  if (normalizedExplicit) {
    return normalizedExplicit;
  }

  throw new MermaidError(
    "E_ARGUMENT",
    `Cannot infer output format for '${outputPath}'; specify -e svg, -e png, or use a .svg/.png extension`
  );
}

function parsePositiveNumber(raw: string, flagName: string): number {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) {
    throw new MermaidError("E_ARGUMENT", `Option '${flagName}' requires a positive number, got '${raw}'`);
  }
  return num;
}

export function parseMmdcArguments(argv: readonly string[]): MmdcParsedArguments {
  let input: string | undefined;
  let output: string | undefined;
  let explicitFormat: string | undefined;
  let theme: MermaidThemeMode | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let scale: number | undefined;
  let svgId: string | undefined;
  let backgroundColor: string | undefined;
  let configFile: string | undefined;
  let quiet = false;
  let help = false;
  let version = false;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") {
      help = true;
      i++;
      continue;
    }
    if (arg === "-V" || arg === "--version") {
      version = true;
      i++;
      continue;
    }
    if (arg === "-q" || arg === "--quiet") {
      quiet = true;
      i++;
      continue;
    }

    // Handle --flag=value syntax
    let flag = arg;
    let inlineVal: string | undefined;
    const eqIdx = arg.indexOf("=");
    if (arg.startsWith("--") && eqIdx > 2) {
      flag = arg.slice(0, eqIdx);
      inlineVal = arg.slice(eqIdx + 1);
    }

    if (FORBIDDEN_FLAGS.has(flag)) {
      throw new MermaidError(
        "E_ARGUMENT",
        `Option '${flag}' (browser/CSS injection) is not supported`
      );
    }

    const consumeValue = (): string => {
      if (inlineVal !== undefined) return inlineVal;
      if (i + 1 >= argv.length) {
        throw new MermaidError("E_ARGUMENT", `Option '${flag}' requires an argument`);
      }
      i++;
      return argv[i]!;
    };

    switch (flag) {
      case "-i":
      case "--input":
        input = consumeValue();
        break;
      case "-o":
      case "--output":
        output = consumeValue();
        break;
      case "-e":
      case "--outputFormat":
        explicitFormat = consumeValue();
        break;
      case "-t":
      case "--theme": {
        const val = consumeValue();
        if (!["light", "dark", "default", "neutral", "forest", "base"].includes(val)) {
          throw new MermaidError(
            "E_ARGUMENT",
            `Unsupported theme '${val}'. Supported themes: default, forest, dark, neutral, base, light`
          );
        }
        theme = val as MermaidThemeMode;
        break;
      }
      case "-w":
      case "--width":
        width = parsePositiveNumber(consumeValue(), flag);
        break;
      case "-H":
      case "--height":
        height = parsePositiveNumber(consumeValue(), flag);
        break;
      case "-s":
      case "--scale":
        scale = parsePositiveNumber(consumeValue(), flag);
        break;
      case "-b":
      case "--backgroundColor":
        backgroundColor = consumeValue();
        break;
      case "-c":
      case "--configFile":
        configFile = consumeValue();
        break;
      case "-I":
      case "--svgId":
        svgId = consumeValue();
        break;
      default:
        throw new MermaidError("E_ARGUMENT", `Unknown or unsupported argument '${arg}'`);
    }
    i++;
  }

  if (help) {
    return {
      action: "help",
      input: input ?? "-",
      output: output ?? "-",
      outputFormat: "svg",
      theme,
      width,
      height,
      scale,
      svgId,
      backgroundColor,
      configFile,
      quiet
    };
  }

  if (version) {
    return {
      action: "version",
      input: input ?? "-",
      output: output ?? "-",
      outputFormat: "svg",
      theme,
      width,
      height,
      scale,
      svgId,
      backgroundColor,
      configFile,
      quiet
    };
  }

  if ((input !== undefined && input.trim().length === 0) || (output !== undefined && output.trim().length === 0)) {
    throw new MermaidError("E_ARGUMENT", "Input and output paths must not be empty");
  }
  input ??= "-";
  output ??= `${input === "-" ? "out" : input}.${explicitFormat ?? "svg"}`;
  if (output === "/dev/stdout") output = "-";
  const outputFormat = inferFormatFromPath(output, explicitFormat);

  return {
    action: "render",
    input,
    output,
    outputFormat,
    theme,
    width,
    height,
    scale,
    svgId,
    backgroundColor,
    configFile,
    quiet
  };
}

export const MMDC_VERSION = "0.0.1";

export const MMDC_HELP_TEXT = [
  "Usage: mmdc [options]",
  "",
  "Render Mermaid diagrams (flowchart, sequence, state, class, ER) to SVG or PNG.",
  "",
  "Options:",
  "  -i, --input <path|->            Input Mermaid file (default: stdin)",
  "  -o, --output <path|->           Output file or '-' for stdout (default: input + .svg, or out.svg)",
  "  -e, --outputFormat <svg|png>    Explicit output format (inferred from -o when omitted)",
  "  -t, --theme <theme>             default, forest, dark, neutral, base, light",
  "  -w, --width <pixels>            Positive viewport width in CSS pixels",
  "  -H, --height <pixels>           Positive viewport height in CSS pixels",
  "  -s, --scale <multiplier>        PNG rasterization scale multiplier (default: 1)",
  "  -b, --backgroundColor <color>   Canvas color (default: white; CSS names, hex, rgb/rgba, transparent)",
  "  -c, --configFile <path>         JSON configuration file for theme and layout spacing",
  "  -I, --svgId <id>               ID of the root SVG element",
  "  -q, --quiet                     Suppress non-fatal status messages",
  "  -h, --help                      Display this help message and exit",
  "  -V, --version                   Display version information and exit",
  ""
].join("\n");
