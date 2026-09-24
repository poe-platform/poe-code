import {
  commandRuntimeIdentity,
  getCommandArguments,
  type CommandContext,
  type CommandDefinition
} from "safe-bash-contracts/command";
import { FsError } from "safe-bash-contracts/errors";
import { compareEntries } from "@poe-code/safe-fs/core";
import type { FileStat } from "safe-bash-contracts/filesystem";
import { writeBytes } from "safe-bash-contracts/io";
import { createOutputOperation, type OutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import { shellValueByteLength } from "safe-bash-contracts/value";
import {
  MMDC_HELP_TEXT,
  MMDC_VERSION,
  parseMmdcArguments,
  type MmdcOutputFormat
} from "./arguments.js";
import {
  admitMermaidLimits,
  defaultMermaidLimits,
  MermaidBudget,
  MermaidError,
  type MermaidAccounting,
  type MermaidPngRenderOptions,
  type MermaidPngResult,
  type MermaidRenderOptions,
  type MermaidSvgResult,
  type MermaidThemeMode,
  type MermaidThemeTokens,
  type MmdcSettings
} from "./contracts.js";
import { verifySceneGeometry } from "./geometry.js";
import { layoutMermaid } from "./layout.js";
import { parseMermaid } from "./parser.js";
import { encodeRgbaToPng } from "./png.js";
import { rasterizeScene } from "./raster.js";
import { serializeSceneToSvg } from "./svg.js";
import { resolveMermaidTheme } from "./theme.js";

const encoder = new TextEncoder();
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

export interface MmdcRunOptions extends MmdcSettings {
  readonly mermaidConfig?: Readonly<Record<string, unknown>> | undefined;
  readonly svgId?: string | undefined;
  readonly argv?: readonly string[] | undefined;
  readonly input?: string | undefined;
  readonly output?: string | undefined;
  readonly outputFormat?: MmdcOutputFormat | undefined;
  readonly themeMode?: MermaidThemeMode | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly scale?: number | undefined;
  readonly backgroundColor?: string | undefined;
  readonly configFile?: string | undefined;
  readonly quiet?: boolean | undefined;
  readonly help?: boolean | undefined;
  readonly version?: boolean | undefined;
}

export interface MmdcResult {
  readonly exitCode: 0 | 1 | 2;
  readonly error?: MermaidError | FsError | undefined;
  readonly accounting: MermaidAccounting;
}

export type MmdcPlugin = VirtualShellPlugin & readonly CommandDefinition[];

function snapshotSettings(settings?: MmdcSettings): MmdcSettings {
  if (!settings) return Object.freeze({});
  const limits = settings.limits ? admitMermaidLimits(settings.limits) : undefined;
  const light = settings.theme?.light ? Object.freeze({ ...settings.theme.light }) : undefined;
  const dark = settings.theme?.dark ? Object.freeze({ ...settings.theme.dark }) : undefined;
  const theme = settings.theme
    ? Object.freeze({
        mode: settings.theme.mode,
        light,
        dark
      })
    : undefined;
  // Validate theme snapshot upfront
  if (theme) {
    resolveMermaidTheme({ settings: { theme } });
  }
  return Object.freeze({
    theme,
    limits,
    replace: settings.replace
  });
}

function normalizeVfsPath(cwd: string, target: string): string {
  const combined = target.startsWith("/") ? target : `${cwd}/${target}`;
  const parts = combined.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return "/" + stack.join("/");
}

function parseMermaidConfig(parsed: unknown): {
  readonly themeMode?: MermaidThemeMode | undefined;
  readonly lightOverrides?: Partial<MermaidThemeTokens> | undefined;
  readonly darkOverrides?: Partial<MermaidThemeTokens> | undefined;
  readonly rankGap?: number | undefined;
  readonly nodeGap?: number | undefined;
  readonly wrappingWidth?: number | undefined;
  readonly padding?: number | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly scale?: number | undefined;
  readonly backgroundColor?: string | undefined;
} {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MermaidError("E_CONFIG", "Configuration file must contain a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  const allowed = new Set([
    "theme",
    "rankGap",
    "nodeGap",
    "padding",
    "width",
    "height",
    "scale",
    "backgroundColor",
    "flowchart",
    "themeVariables"
  ]);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new MermaidError("E_CONFIG", `Unknown configuration key '${key}'`);
    }
  }

  let themeMode: MermaidThemeMode | undefined;
  let lightOverrides: Partial<MermaidThemeTokens> | undefined;
  let darkOverrides: Partial<MermaidThemeTokens> | undefined;

  if (obj.theme !== undefined) {
    if (typeof obj.theme === "string") {
      if (!["light", "dark", "default", "neutral", "forest", "base"].includes(obj.theme)) {
        throw new MermaidError("E_CONFIG", `Unsupported theme '${obj.theme}' in config file`);
      }
      themeMode = obj.theme as MermaidThemeMode;
    } else if (obj.theme && typeof obj.theme === "object" && !Array.isArray(obj.theme)) {
      const tObj = obj.theme as Record<string, unknown>;
      for (const k of Object.keys(tObj)) {
        if (k !== "mode" && k !== "light" && k !== "dark") {
          throw new MermaidError("E_CONFIG", `Unknown theme configuration key '${k}'`);
        }
      }
      if (tObj.mode !== undefined) {
        if (typeof tObj.mode !== "string" || !["light", "dark", "default", "neutral", "forest", "base"].includes(tObj.mode)) {
          throw new MermaidError("E_CONFIG", `Unsupported theme mode '${String(tObj.mode)}'`);
        }
        themeMode = tObj.mode as MermaidThemeMode;
      }
      for (const key of ["light", "dark"]) {
        if (tObj[key] !== undefined && (!tObj[key] || typeof tObj[key] !== "object" || Array.isArray(tObj[key]))) {
          throw new MermaidError("E_CONFIG", `Theme configuration '${key}' must be an object`);
        }
      }
      if (tObj.light && typeof tObj.light === "object") {
        lightOverrides = tObj.light as Partial<MermaidThemeTokens>;
      }
      if (tObj.dark && typeof tObj.dark === "object") {
        darkOverrides = tObj.dark as Partial<MermaidThemeTokens>;
      }
    } else {
      throw new MermaidError("E_CONFIG", "Invalid 'theme' value in configuration file");
    }
  }

  const numField = (name: string): number | undefined => {
    const val = obj[name];
    if (val === undefined) return undefined;
    if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) {
      throw new MermaidError("E_CONFIG", `Configuration '${name}' must be a positive number`);
    }
    return val;
  };

  const backgroundColor =
    obj.backgroundColor !== undefined
      ? typeof obj.backgroundColor === "string"
        ? obj.backgroundColor
        : (() => {
            throw new MermaidError("E_CONFIG", "Configuration 'backgroundColor' must be a string");
          })()
      : undefined;

  const flowchart = obj.flowchart ?? {};
  if (!flowchart || typeof flowchart !== "object" || Array.isArray(flowchart)) {
    throw new MermaidError("E_CONFIG", "Configuration 'flowchart' must be an object");
  }
  const flow = flowchart as Record<string, unknown>;
  for (const key of Object.keys(flow)) {
    if (!["rankSpacing", "nodeSpacing", "wrappingWidth"].includes(key)) {
      throw new MermaidError("E_CONFIG", `Unsupported flowchart configuration '${key}'`);
    }
    if (typeof flow[key] !== "number" || !Number.isFinite(flow[key]) || (flow[key] as number) <= 0) {
      throw new MermaidError("E_CONFIG", `Configuration 'flowchart.${key}' must be a positive number`);
    }
  }
  const variables = obj.themeVariables ?? {};
  if (!variables || typeof variables !== "object" || Array.isArray(variables)) {
    throw new MermaidError("E_CONFIG", "Configuration 'themeVariables' must be an object");
  }
  const variableTokens: Readonly<Record<string, readonly (keyof MermaidThemeTokens)[]>> = {
    primaryColor: ["surface", "surfaceAccent", "accentSurface"],
    primaryTextColor: ["text", "accentText"],
    primaryBorderColor: ["border", "accentBorder"],
    lineColor: ["edge"],
    textColor: ["text"],
    background: ["canvas"],
    noteBkgColor: ["noteSurface"],
    noteTextColor: ["noteText"],
    noteBorderColor: ["noteBorder"]
  };
  const palette: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(variables)) {
    const tokens = variableTokens[key];
    if (!tokens) throw new MermaidError("E_CONFIG", `Unsupported theme variable '${key}'`);
    if (typeof value !== "string") throw new MermaidError("E_CONFIG", `Theme variable '${key}' must be a color string`);
    for (const token of tokens) palette[token] = value;
  }

  return {
    themeMode,
    lightOverrides: { ...lightOverrides, ...palette },
    darkOverrides: { ...darkOverrides, ...palette },
    rankGap: numField("rankGap") ?? flow.rankSpacing as number | undefined,
    nodeGap: numField("nodeGap") ?? flow.nodeSpacing as number | undefined,
    wrappingWidth: flow.wrappingWidth as number | undefined,
    padding: numField("padding"),
    width: numField("width"),
    height: numField("height"),
    scale: numField("scale"),
    backgroundColor
  };
}

function resolveRenderOptions(options?: MermaidPngRenderOptions): MermaidPngRenderOptions | undefined {
  if (!options || options.mermaidConfig === undefined) return options;
  const config = parseMermaidConfig(options.mermaidConfig);
  return {
    ...options,
    theme: config.themeMode ?? options.theme,
    rankGap: options.rankGap ?? config.rankGap,
    nodeGap: options.nodeGap ?? config.nodeGap,
    wrappingWidth: options.wrappingWidth ?? config.wrappingWidth,
    width: options.width ?? config.width,
    height: options.height ?? config.height,
    padding: options.padding ?? config.padding,
    scale: options.scale ?? config.scale,
    backgroundColor: options.backgroundColor ?? config.backgroundColor,
    settings: { ...options.settings, theme: {
      ...options.settings?.theme,
      light: { ...config.lightOverrides, ...options.settings?.theme?.light },
      dark: { ...config.darkOverrides, ...options.settings?.theme?.dark }
    } }
  };
}

export function renderMermaidSvg(
  source: string,
  options?: MermaidRenderOptions
): MermaidSvgResult {
  options = resolveRenderOptions(options);
  const hostCeiling = options?.settings?.limits
    ? admitMermaidLimits(options.settings.limits, defaultMermaidLimits)
    : defaultMermaidLimits;
  const limits = admitMermaidLimits(options?.limits, hostCeiling);
  const budget = options?.budget ?? new MermaidBudget(limits, options?.signal);

  const doc = parseMermaid(source, { budget, limits, signal: options?.signal });
  const mergedDoc =
    options?.title !== undefined || options?.description !== undefined
      ? {
          ...doc,
          title: options?.title ?? doc.title,
          description: options?.description ?? doc.description
        }
      : doc;

  const scene = layoutMermaid(mergedDoc, { ...options, backgroundColor: options?.backgroundColor ?? "white", budget, limits });
  const check = verifySceneGeometry(scene);
  if (!check.ok) {
    throw new MermaidError(
      "E_LIMIT",
      `Scene geometry verification failed: ${check.violations[0] ?? "invalid geometry"}`
    );
  }
  const svg = serializeSceneToSvg(scene, budget, options?.svgId);

  return {
    svg,
    width: scene.width,
    height: scene.height,
    naturalBounds: scene.naturalBounds,
    family: scene.family,
    accounting: budget.snapshot()
  };
}

export function renderMermaidPng(
  source: string,
  options?: MermaidPngRenderOptions
): MermaidPngResult {
  options = resolveRenderOptions(options);
  const hostCeiling = options?.settings?.limits
    ? admitMermaidLimits(options.settings.limits, defaultMermaidLimits)
    : defaultMermaidLimits;
  const limits = admitMermaidLimits(options?.limits, hostCeiling);
  const budget = options?.budget ?? new MermaidBudget(limits, options?.signal);

  const doc = parseMermaid(source, { budget, limits, signal: options?.signal });
  const mergedDoc =
    options?.title !== undefined || options?.description !== undefined
      ? {
          ...doc,
          title: options?.title ?? doc.title,
          description: options?.description ?? doc.description
        }
      : doc;

  const scene = layoutMermaid(mergedDoc, { ...options, backgroundColor: options?.backgroundColor ?? "white", budget, limits });
  const check = verifySceneGeometry(scene);
  if (!check.ok) {
    throw new MermaidError(
      "E_LIMIT",
      `Scene geometry verification failed: ${check.violations[0] ?? "invalid geometry"}`
    );
  }

  const scale = options?.scale ?? 1;
  const raster = rasterizeScene(scene, { scale, budget });
  const png = encodeRgbaToPng(raster.rgba, raster.width, raster.height, budget);

  return {
    png,
    width: raster.width,
    height: raster.height,
    scale: raster.scale,
    naturalBounds: scene.naturalBounds,
    family: scene.family,
    accounting: budget.snapshot()
  };
}

async function readVfsBytes(
  context: CommandContext,
  path: string,
  maxBytes: number,
  signal: AbortSignal
): Promise<Uint8Array> {
  if (context.fs.readFile) {
    return await context.fs.readFile(path, { signal, maxBytes });
  }
  if (context.fs.readStream) {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of context.fs.readStream(path, { signal })) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        throw new MermaidError("E_LIMIT", "Input byte limit exceeded", {
          limit: "maxSourceBytes"
        });
      }
      chunks.push(chunk.slice());
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return merged;
  }
  throw new MermaidError("E_IO", "Filesystem does not support reading files");
}

async function readStdinBytes(
  context: CommandContext,
  maxBytes: number,
  signal: AbortSignal
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of context.stdin) {
    signal.throwIfAborted();
    total += chunk.byteLength;
    context.inputBudget?.check(total);
    if (total > maxBytes) {
      throw new MermaidError("E_LIMIT", "Input byte limit exceeded", {
        limit: "maxSourceBytes"
      });
    }
    chunks.push(chunk.slice());
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged;
}

export async function runMmdc(
  context: CommandContext,
  options: MmdcRunOptions = {}
): Promise<MmdcResult> {
  const snapSettings = snapshotSettings(options);
  const hostLimits = admitMermaidLimits(snapSettings.limits, defaultMermaidLimits);
  const controller = new AbortController();
  const signal = controller.signal;
  const onContextAbort = (): void => controller.abort(context.signal.reason);
  const budget = new MermaidBudget(hostLimits, signal);

  let stdout: OutputOperation | undefined;
  let stderr: OutputOperation | undefined;
  let closing: Promise<void> | undefined;

  const cleanup = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      controller.abort(new MermaidError("E_CANCELLED", "mmdc invocation closed"));
      context.signal.removeEventListener("abort", onContextAbort);
      await Promise.allSettled([stdout?.close(), stderr?.close()]);
    })();
    return closing;
  };
  context.registerCleanup?.(cleanup);

  try {
    context.signal.addEventListener("abort", onContextAbort, { once: true });
    if (context.signal.aborted) onContextAbort();
    budget.check();

    stdout = createOutputOperation({ signal }, context.stdout);
    stderr = createOutputOperation({ signal }, context.stderr);

    // Check typed options vs literal argv
    const typedOptionKeys = [
      "input",
      "output",
      "outputFormat",
      "themeMode",
      "width",
      "height",
      "scale",
      "backgroundColor",
      "configFile",
      "quiet",
      "help",
      "version",
      "svgId",
      "mermaidConfig"
    ] as const;
    const hasTypedOptions = typedOptionKeys.some((k) => options[k] !== undefined);
    if (hasTypedOptions && options.argv !== undefined) {
      throw new MermaidError(
        "E_ARGUMENT",
        "Specify either literal 'argv' or typed MmdcRunOptions, not both"
      );
    }

    let argv: string[];
    if (hasTypedOptions) {
      argv = [];
      if (options.help) argv.push("--help");
      if (options.version) argv.push("--version");
      if (options.quiet) argv.push("--quiet");
      if (options.input !== undefined) argv.push("-i", options.input);
      if (options.output !== undefined) argv.push("-o", options.output);
      if (options.outputFormat !== undefined) argv.push("-e", options.outputFormat);
      if (options.themeMode !== undefined) argv.push("-t", options.themeMode);
      if (options.width !== undefined) argv.push("-w", String(options.width));
      if (options.height !== undefined) argv.push("-H", String(options.height));
      if (options.scale !== undefined) argv.push("-s", String(options.scale));
      if (options.backgroundColor !== undefined) argv.push("-b", options.backgroundColor);
      if (options.configFile !== undefined) argv.push("-c", options.configFile);
      if (options.svgId !== undefined) argv.push("-I", options.svgId);
    } else if (options.argv !== undefined) {
      argv = [...options.argv];
    } else {
      const carrier = getCommandArguments(context);
      argv = [];
      for (let i = 0; i < carrier.args.length; i++) {
        const val = carrier.values[i]!;
        budget.chargeWork(shellValueByteLength(val) + 1);
        if (typeof val === "string") {
          argv.push(carrier.args[i]!);
        } else {
          try {
            argv.push(fatalUtf8Decoder.decode(carrier.bytes(i)));
          } catch {
            throw new MermaidError("E_ARGUMENT", "CLI arguments must be valid UTF-8");
          }
        }
      }
    }

    const parsedArgs = parseMmdcArguments(argv);

    if (parsedArgs.action === "help") {
      const bytes = encoder.encode(MMDC_HELP_TEXT);
      budget.chargeOutputBytes(bytes.byteLength);
      await writeBytes(stdout.output, bytes, signal);
      return { exitCode: 0, accounting: budget.snapshot() };
    }

    if (parsedArgs.action === "version") {
      const bytes = encoder.encode(`${MMDC_VERSION}\n`);
      budget.chargeOutputBytes(bytes.byteLength);
      await writeBytes(stdout.output, bytes, signal);
      return { exitCode: 0, accounting: budget.snapshot() };
    }

    // Load optional JSON config file from VFS
    if (options.mermaidConfig !== undefined && parsedArgs.configFile !== undefined) {
      throw new MermaidError("E_ARGUMENT", "Specify either mermaidConfig or configFile, not both");
    }
    const inlineConfig = options.mermaidConfig === undefined ? undefined : parseMermaidConfig(options.mermaidConfig);
    let cfgThemeMode = inlineConfig?.themeMode;
    let cfgLight = inlineConfig?.lightOverrides;
    let cfgDark = inlineConfig?.darkOverrides;
    let cfgRankGap = inlineConfig?.rankGap;
    let cfgNodeGap = inlineConfig?.nodeGap;
    let cfgWrappingWidth = inlineConfig?.wrappingWidth;
    let cfgPadding = inlineConfig?.padding;
    let cfgWidth = inlineConfig?.width;
    let cfgHeight = inlineConfig?.height;
    let cfgScale = inlineConfig?.scale;
    let cfgBg = inlineConfig?.backgroundColor;

    if (parsedArgs.configFile !== undefined) {
      const cfgPath = normalizeVfsPath(context.cwd, parsedArgs.configFile);
      const rawBytes = await readVfsBytes(context, cfgPath, 65536, signal);
      let cfgText: string;
      try {
        cfgText = fatalUtf8Decoder.decode(rawBytes);
      } catch {
        throw new MermaidError("E_CONFIG", "Configuration file must be valid UTF-8");
      }
      let config: unknown;
      try { config = JSON.parse(cfgText); } catch {
        throw new MermaidError("E_CONFIG", "Invalid JSON in configuration file");
      }
      const cfg = parseMermaidConfig(config);
      cfgThemeMode = cfg.themeMode;
      cfgLight = cfg.lightOverrides;
      cfgDark = cfg.darkOverrides;
      cfgRankGap = cfg.rankGap;
      cfgNodeGap = cfg.nodeGap;
      cfgWrappingWidth = cfg.wrappingWidth;
      cfgPadding = cfg.padding;
      cfgWidth = cfg.width;
      cfgHeight = cfg.height;
      cfgScale = cfg.scale;
      cfgBg = cfg.backgroundColor;
    }

    // Resolve and check VFS paths & alias protection before reading/writing
    const inPath =
      parsedArgs.input === "-" ? "-" : normalizeVfsPath(context.cwd, parsedArgs.input);
    const outPath =
      parsedArgs.output === "-" ? "-" : normalizeVfsPath(context.cwd, parsedArgs.output);

    let expectedOutStat: FileStat | null = null;
    let parentOutStat: FileStat | undefined;

    if (outPath !== "-") {
      if (inPath !== "-" && inPath === outPath) {
        throw new MermaidError("E_IO", "Input and output file paths must be distinct");
      }
      if (context.fs.lstat) {
        try {
          expectedOutStat = await context.fs.lstat(outPath, { signal });
        } catch (err) {
          if (!(err instanceof FsError && err.code === "ENOENT")) throw err;
        }
        if (expectedOutStat && expectedOutStat.type !== "file") {
          throw new MermaidError("E_IO", "Output target must be a regular file");
        }
      }
      if (inPath !== "-" && context.fs.realpath) {
        const realIn = await context.fs.realpath(inPath, { signal });
        const outDir = outPath.slice(0, outPath.lastIndexOf("/")) || "/";
        const realOutDir = await context.fs.realpath(outDir, { signal });
        const realOut = normalizeVfsPath(realOutDir, outPath.slice(outPath.lastIndexOf("/") + 1));
        if (
          realIn === realOut ||
          (expectedOutStat !== null &&
            (await compareEntries(context.fs, realIn, context.fs, realOut, { signal })) !==
              "distinct")
        ) {
          throw new MermaidError("E_IO", "Input and output VFS entries must not alias the same file");
        }
      }
      if (context.fs.stat) {
        const parentDir = outPath.slice(0, outPath.lastIndexOf("/")) || "/";
        parentOutStat = await context.fs.stat(parentDir, { signal });
      }
    }

    // Read input UTF-8 bytes
    const rawInputBytes =
      inPath === "-"
        ? await readStdinBytes(context, hostLimits.maxSourceBytes, signal)
        : await readVfsBytes(context, inPath, hostLimits.maxSourceBytes, signal);

    let sourceText: string;
    try {
      sourceText = fatalUtf8Decoder.decode(rawInputBytes);
    } catch {
      throw new MermaidError("E_SYNTAX", "Diagram input is not valid UTF-8", {
        span: { offset: 0, line: 1, column: 1 }
      });
    }

    // Yield before parse/layout so cancellation can be observed
    await Promise.resolve();
    budget.check();

    // Mermaid config overrides the CLI theme, matching the standard command.
    const resolvedMode: MermaidThemeMode =
      cfgThemeMode ?? parsedArgs.theme ?? snapSettings.theme?.mode ?? "light";

    const mergedSettings: MmdcSettings = {
      theme: {
        mode: resolvedMode,
        light: { ...cfgLight, ...snapSettings.theme?.light },
        dark: { ...cfgDark, ...snapSettings.theme?.dark }
      },
      limits: hostLimits
    };

    const renderOptions: MermaidPngRenderOptions = {
      theme: resolvedMode,
      settings: mergedSettings,
      limits: hostLimits,
      signal,
      budget,
      width: parsedArgs.width ?? cfgWidth,
      height: parsedArgs.height ?? cfgHeight,
      scale: parsedArgs.scale ?? cfgScale ?? 1,
      svgId: parsedArgs.svgId,
      backgroundColor: parsedArgs.backgroundColor ?? cfgBg,
      rankGap: cfgRankGap,
      nodeGap: cfgNodeGap,
      wrappingWidth: cfgWrappingWidth,
      padding: cfgPadding
    };

    let outputBytes: Uint8Array;
    if (parsedArgs.outputFormat === "svg") {
      const res = renderMermaidSvg(sourceText, renderOptions);
      outputBytes = encoder.encode(res.svg);
    } else {
      await Promise.resolve();
      budget.check();
      const res = renderMermaidPng(sourceText, renderOptions);
      outputBytes = res.png;
    }

    // Yield before publishing so cancellation stops before VFS write
    await Promise.resolve();
    budget.check();

    if (outPath === "-") {
      await writeBytes(stdout.output, outputBytes, signal);
    } else if (context.fs.writeFileConditional && parentOutStat) {
      await context.fs.writeFileConditional(outPath, outputBytes, {
        expected: expectedOutStat,
        parent: parentOutStat,
        signal
      });
    } else if (context.fs.publishFileConditional && parentOutStat) {
      const stream = (async function* () {
        yield outputBytes;
      })();
      await context.fs.publishFileConditional(outPath, stream, {
        expected: expectedOutStat,
        parent: parentOutStat,
        signal,
        maxBytes: hostLimits.maxOutputBytes
      });
    } else if (context.fs.writeFile) {
      await context.fs.writeFile(outPath, outputBytes, { signal });
    } else {
      throw new MermaidError("E_IO", "Filesystem does not support atomic file publication");
    }

    return {
      exitCode: 0,
      accounting: budget.snapshot()
    };
  } catch (error) {
    if (context.signal.aborted || signal.aborted) {
      throw error;
    }
    if (error instanceof MermaidError || error instanceof FsError) {
      const code = error instanceof MermaidError ? error.code : "E_IO";
      const exitCode: 1 | 2 = error instanceof MermaidError ? error.exitCode : 1;
      const spanInfo =
        error instanceof MermaidError && error.span
          ? ` (line ${error.span.line}, column ${error.span.column})`
          : "";
      const diagnosticLine = `mmdc: ${code}${spanInfo}: ${error.message}\n`;
      if (stderr) {
        try {
          await writeBytes(stderr.output, encoder.encode(diagnosticLine), signal);
        } catch {
          // Ignore secondary stderr write failure during error reporting
        }
      }
      return {
        exitCode,
        error,
        accounting: budget.snapshot()
      };
    }
    throw error;
  } finally {
    await cleanup();
  }
}

export function createMmdcCommand(settings?: MmdcSettings): CommandDefinition {
  const captured = snapshotSettings(settings);
  return Object.freeze({
    name: "mmdc",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Render Mermaid diagrams to SVG or PNG",
    execute(context: CommandContext) {
      return runMmdc(context, captured);
    }
  });
}

export const mmdcCommand: CommandDefinition = createMmdcCommand();

export function mmdcCommands(settings?: MmdcSettings): MmdcPlugin {
  const command = createMmdcCommand(settings);
  const replace = settings?.replace ?? false;
  const plugin = Object.assign([command], {
    name: "mmdc-commands",
    setup(host: { commands: { register(cmd: CommandDefinition, opts?: { replace?: boolean }): void } }) {
      host.commands.register(command, { replace });
    }
  });
  return Object.freeze(plugin) as MmdcPlugin;
}
