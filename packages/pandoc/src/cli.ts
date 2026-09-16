import { PandocError } from "./errors.js";
import type { ConversionOptions, InputSource, MetadataObject, WriteOptions } from "./types.js";
import {createFormatRegistry} from "./formats.js";
import { resourceDirectory } from "./resources.js";

export interface CommandInputs {
  readonly cwd?: string;
  readonly stdin?: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
  readFile?(path: string, signal: AbortSignal): Promise<Uint8Array>;
  writeFile?(path: string, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
}

/** Parsing creates lazy inputs. Only the validated converter may acquire them. */
export function parseConversionArgs(args: readonly string[], files: CommandInputs, signal: AbortSignal): {options: ConversionOptions; operands: readonly InputSource[] | undefined; destination?: string} {
  const options: {from?: string; to?: string; wrap?: "none"; lossy?: boolean; standalone?: boolean; failIfWarnings?: boolean; rawContent?: "reject" | "escape" | "retain"; resourcePath?: readonly string[]; extractMedia?: string; pdfPage?: NonNullable<WriteOptions["pdfPage"]>} = {};
  const pdfFonts: InputSource[] = [];
  const metadataJson: MetadataObject[] = [];
  const metadataFiles: InputSource[] = [];
  const operands: InputSource[] = [];
  let destination: string | undefined;
  let yes = false;
  const names = new Map([["-f", "from"], ["--from", "from"], ["-t", "to"], ["--to", "to"], ["--raw-content", "rawContent"], ["--wrap", "wrap"]] as const);
  const fail = (message: string): never => {throw new PandocError("E_OPTION", "convert", message);};
  const source = (path: string, metadata = false): InputSource => {
    if (!files.readFile) fail("File operands require an explicit readFile capability");
    const split = path.lastIndexOf("/");
    const base = resourceDirectory(split < 0 ? "." : path.slice(0, split) || "/", files.cwd ?? "/");
    return {source: path, base: metadata ? path : base, chunks: (async function* () {yield await files.readFile!(path, signal);})()};
  };
  let positional = false;
  let stdinUsed = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!positional && arg === "--yes") {if (yes) fail("Repeated option: --yes"); yes = true; continue;}
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
    if (name === "--pdf-engine") fail("External PDF engines are forbidden; use the built-in TypeScript PDF writer");
    if (name === "--pdf-font" || name === "--pdf-page") {
      const value = equals < 0 ? args[++i] : arg.slice(equals + 1);
      if (!value || value.startsWith("-")) fail(`Missing value: ${name}`);
      if (name === "--pdf-font") pdfFonts.push(source(value!));
      else {
        if (options.pdfPage !== undefined) fail("Repeated pdf-page option");
        const parts = value!.split(",");
        if (parts.length !== 3 || parts.some(part => !part.trim() || !Number.isFinite(Number(part)))) fail("pdf-page requires WIDTH,HEIGHT,MARGIN in points");
        options.pdfPage = {width: Number(parts[0]), height: Number(parts[1]), margin: Number(parts[2])};
      }
      continue;
    }
    if (name === "--resource-path" || name === "--extract-media") {
      const value = equals < 0 ? args[++i] : arg.slice(equals + 1);
      if (!value || value.startsWith("-")) fail(`Missing value: ${name}`);
      if (name === "--resource-path") {
        const paths = value!.split(":");
        if (paths.some(path => !path)) fail("Empty resource-path directory");
        options.resourcePath = paths;
      } else {
        if (options.extractMedia !== undefined) fail("Repeated extract-media option");
        options.extractMedia = value!;
      }
      continue;
    }
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
  if (yes && !options.to && destination !== undefined && destination.endsWith(".pdf")) options.to = createFormatRegistry().infer(destination, "write");
  if (!options.from || !options.to) fail("Explicit -f FORMAT and -t FORMAT are required");
  if (destination !== undefined && options.extractMedia !== undefined) {
    const output = resourceDirectory(destination, files.cwd ?? "/");
    const media = resourceDirectory(options.extractMedia, files.cwd ?? "/");
    if (output === media || media === "/" || output.startsWith(`${media}/`)) fail("Output cannot be inside the extraction directory");
  }
  return {options: {...options, from: options.from!, to: options.to!, ...(pdfFonts.length ? {pdfFonts} : {}), ...(metadataJson.length ? {metadataJson} : {}), ...(metadataFiles.length ? {metadataFiles} : {})}, operands: operands.length ? operands : undefined, ...(destination === undefined ? {} : {destination})};
}
