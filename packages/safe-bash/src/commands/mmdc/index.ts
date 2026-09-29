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
  const def = createRawMmdcCommand(settings);
  builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createMmdcCommands(options: MmdcCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawMmdcCommands(options);
  for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  return defs;
}

export function mmdcCommands(settings?: MmdcSettings): MmdcPlugin {
  const plugin = rawMmdcCommands(settings);
  for (let i = 0; i < plugin.length; i++) builtInDirectContextExecutors.add(plugin[i]!.execute);
  return plugin;
}

export function evalSyncMmdc(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    const parsed = parseMmdcArguments(opArgs);
    if (parsed.action === "help") return MMDC_HELP_TEXT;
    if (parsed.action === "version") return `${MMDC_VERSION}\n`;
    if (parsed.output !== "-" || parsed.outputFormat !== "svg") return undefined;
    if (parsed.configFile !== undefined) return undefined;
    const rawBytes = parsed.input === "-" ? inBytes : readFileSync?.(parsed.input);
    if (!rawBytes || rawBytes.byteLength > 262144) return undefined;
    const sourceText = utf8Decoder.decode(rawBytes);
    const res = renderMermaidSvg(sourceText, {
      theme: parsed.theme ?? "light",
      width: parsed.width,
      height: parsed.height,
      svgId: parsed.svgId,
      backgroundColor: parsed.backgroundColor,
    });
    return res.svg;
  } catch {
    return undefined;
  }
}

syncCommandEvaluators.evalSyncMmdc = evalSyncMmdc;
