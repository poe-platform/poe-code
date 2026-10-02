import { builtInDirectContextExecutors, syncCommandEvaluators } from "../internal.js";
import type { CommandDefinition } from "../../contracts/index.js";
import {
  createMmdcCommand as createRawMmdcCommand,
  createMmdcCommands as createRawMmdcCommands,
  mmdcCommands as rawMmdcCommands,
  MMDC_HELP_TEXT,
  MMDC_VERSION,
  parseMmdcArguments,
  renderMermaidSvg,
  type MmdcCommandsOptions,
  type MmdcPlugin,
  type MmdcSettings,
} from "safe-bash-command-mmdc";

export * from "safe-bash-command-mmdc";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function createMmdcCommand(settings?: MmdcSettings): CommandDefinition {
  syncCommandEvaluators.evalSyncMmdc = evalSyncMmdc;
  const def = createRawMmdcCommand(settings);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createMmdcCommands(options: MmdcCommandsOptions = {}): readonly CommandDefinition[] {
  syncCommandEvaluators.evalSyncMmdc = evalSyncMmdc;
  const defs = createRawMmdcCommands(options);
  for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  return defs;
}

export function mmdcCommands(settings?: MmdcSettings): MmdcPlugin {
  const plugin = rawMmdcCommands(settings);
  for (let i = 0; i < plugin.length; i++) builtInDirectContextExecutors.add(plugin[i]!.execute);
  return plugin;
}

const mmdcUtf8Encoder = new TextEncoder();

export function evalSyncMmdc(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  try {
    const parsed = parseMmdcArguments(opArgs);
    if (parsed.action === "help") return MMDC_HELP_TEXT;
    if (parsed.action === "version") return `${MMDC_VERSION}\n`;
    if (parsed.outputFormat !== "svg") return undefined;
    let cfgTheme: string | undefined;
    let cfgWidth: number | undefined;
    let cfgHeight: number | undefined;
    let cfgSvgId: string | undefined;
    let cfgBg: string | undefined;
    if (parsed.configFile !== undefined) {
      const cfgBytes = readFileSync?.(parsed.configFile);
      if (!cfgBytes || cfgBytes.includes(0)) return undefined;
      const cfg = JSON.parse(utf8Decoder.decode(cfgBytes)) as Record<string, unknown>;
      if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return undefined;
      const allowedKeys = new Set(["theme", "rankGap", "nodeGap", "padding", "width", "height", "scale", "backgroundColor", "flowchart", "themeVariables"]);
      if (Object.keys(cfg).some(k => !allowedKeys.has(k))) return undefined;
      if (typeof cfg.theme === "string") cfgTheme = cfg.theme;
      if (typeof cfg.width === "number") cfgWidth = cfg.width;
      if (typeof cfg.height === "number") cfgHeight = cfg.height;
      if (typeof cfg.backgroundColor === "string") cfgBg = cfg.backgroundColor;
    }
    const rawBytes = parsed.input === "-" ? inBytes : readFileSync?.(parsed.input);
    if (!rawBytes || rawBytes.byteLength > 262144 || rawBytes.includes(0)) return undefined;
    const sourceText = utf8Decoder.decode(rawBytes);
    const res = renderMermaidSvg(sourceText, {
      theme: (parsed.theme ?? cfgTheme ?? "light") as "light",
      width: parsed.width ?? cfgWidth,
      height: parsed.height ?? cfgHeight,
      svgId: parsed.svgId ?? cfgSvgId,
      backgroundColor: parsed.backgroundColor ?? cfgBg,
    });
    if (res.svg.includes("\0")) return undefined;
    if (parsed.output !== "-") {
      if (!writeFileSync || !writeFileSync(parsed.output, mmdcUtf8Encoder.encode(res.svg))) return undefined;
      return "";
    }
    return res.svg;
  } catch {
    return undefined;
  }
}
