import { PandocError } from "./errors.js";
import type { ConversionOptions, InputSource, MetadataObject } from "./types.js";

export interface CommandInputs {
  readonly stdin?: AsyncIterable<Uint8Array>;
  readFile?(path: string, signal: AbortSignal): Promise<Uint8Array>;
  writeFile?(path: string, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
}

/** Parsing creates lazy inputs. Only the validated converter may acquire them. */
export function parseConversionArgs(args: readonly string[], files: CommandInputs, signal: AbortSignal): {options: ConversionOptions; operands: readonly InputSource[] | undefined; destination?: string} {
  const options: {from?: string; to?: string; wrap?: "none"; lossy?: boolean; standalone?: boolean; failIfWarnings?: boolean; rawContent?: "reject" | "escape" | "retain"} = {};
  const metadataJson: MetadataObject[] = [];
  const metadataFiles: InputSource[] = [];
  const operands: InputSource[] = [];
  let destination: string | undefined;
  const names = new Map([["-f", "from"], ["--from", "from"], ["-t", "to"], ["--to", "to"], ["--raw-content", "rawContent"], ["--wrap", "wrap"]] as const);
  const fail = (message: string): never => {throw new PandocError("E_OPTION", "convert", message);};
  const source = (path: string, metadata = false): InputSource => {
    if (!files.readFile) fail("File operands require an explicit readFile capability");
    return {source: path, ...(metadata ? {base: path} : {}), chunks: (async function* () {yield await files.readFile!(path, signal);})()};
  };
  let positional = false;
  let stdinUsed = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--" && !positional) {positional = true; continue;}
    if (arg === "-" && !positional) {
      if (stdinUsed || !files.stdin) fail("Stdin may be supplied once");
      stdinUsed = true;
      operands.push({chunks: files.stdin!, source: "stdin"}); continue;
    }
    if (positional || !arg.startsWith("-")) {operands.push(source(arg)); continue;}
    if (arg === "--lossy" || arg === "--standalone" || arg === "-s" || arg === "--fail-if-warnings") {
      const key = arg === "--lossy" ? "lossy" : arg === "--fail-if-warnings" ? "failIfWarnings" : "standalone";
      if (options[key] !== undefined) fail(`Repeated option: ${arg}`);
      options[key] = true; continue;
    }
    const equals = arg.indexOf("=");
    const name = equals < 0 ? arg : arg.slice(0, equals);
    if (name === "--metadata-file") {
      const path = equals < 0 ? args[++i] : arg.slice(equals + 1);
      if (!path || !path.endsWith(".json")) fail("Metadata files must use .json; YAML is unsupported");
      metadataFiles.push(source(path!, true)); continue;
    }
    if (name === "-o" || name === "--output") {
      const path = equals < 0 ? args[++i] : arg.slice(equals + 1);
      if (!path || destination !== undefined || !files.writeFile) fail("Output requires one path and an explicit writeFile capability");
      destination = path; continue;
    }
    if (arg === "--metadata" || arg.startsWith("--metadata=") || arg.startsWith("-M")) {
      const value = arg === "--metadata" || arg === "-M" ? args[++i] : arg.startsWith("--metadata=") ? arg.slice(11) : arg.slice(2);
      if (value === undefined) fail("Missing metadata value");
      const split = Math.min(...[value!.indexOf("="), value!.indexOf(":")].filter(n => n >= 0));
      if (!Number.isFinite(split) || split < 1) fail("Metadata requires KEY=VALUE or KEY:VALUE");
      const key = value!.slice(0, split);
      if (["__proto__", "constructor", "prototype"].includes(key) || [...key].some(ch => !(ch >= "a" && ch <= "z") && !(ch >= "A" && ch <= "Z") && !(ch >= "0" && ch <= "9") && ch !== "-" && ch !== "_")) fail("Invalid metadata key");
      const content = value!.slice(split + 1);
      if (content.startsWith("{") || content.startsWith("[") || content.startsWith('"') || ["true", "false", "null"].includes(content)) {
        let parsed: unknown;
        try {parsed = JSON.parse(content);} catch {fail("Invalid JSON metadata value");}
        metadataJson.push({[key]: parsed as import("./types.js").MetadataValue});
      } else {
        // Put all CLI assignments in one ordered JSON stream so types can collide.
        metadataJson.push({[key]: content});
      }
      continue;
    }
    const key = names.get(name as "-f" | "--from" | "-t" | "--to" | "--raw-content" | "--wrap");
    if (!key) fail(`Unsupported option: ${name}`);
    if (options[key!] !== undefined) fail(`Repeated option: ${name}`);
    const value = equals < 0 ? args[++i] : arg.slice(equals + 1);
    if (!value || value.startsWith("-")) fail(`Missing value: ${name}`);
    if (key === "wrap") {if (value !== "none") fail("Only wrap none is supported"); options.wrap = "none";}
    else if (key === "rawContent") {if (value !== "reject" && value !== "escape" && value !== "retain") fail("Invalid raw-content policy"); options.rawContent = value as "reject" | "escape" | "retain";}
    else if (key === "from" || key === "to") options[key] = value!;
  }
  if (!options.from || !options.to) fail("Explicit -f FORMAT and -t FORMAT are required");
  return {options: {...options, from: options.from!, to: options.to!, ...(metadataJson.length ? {metadataJson} : {}), ...(metadataFiles.length ? {metadataFiles} : {})}, operands: operands.length ? operands : undefined, ...(destination === undefined ? {} : {destination})};
}
