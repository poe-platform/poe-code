import {parseDocument} from "yaml";
import {parseConversionArgs, type CommandInputs} from "./cli.js";
import {ExecutionContext} from "./execution.js";
import {mergeJsonMetadata} from "./metadata.js";
import type {ConversionContext, Limits} from "./types.js";

/** Resolve explicitly named local defaults; synchronous argument parsing remains I/O-free. */
export async function resolveConversionArgs(args: readonly string[], files: CommandInputs, signal: AbortSignal, context: ConversionContext = {}) {
  const execution: ExecutionContext = new ExecutionContext("convert", {...context, signal});
  const valueFlags = new Set(["-f", "--from", "-r", "--read", "-t", "--to", "-w", "--write", "-o", "--output", "--template", "-V", "--variable", "--variable-json", "-M", "--metadata", "--metadata-file", "-H", "--include-in-header", "-B", "--include-before-body", "-A", "--include-after-body", "--wrap", "--columns", "--shift-heading-level-by", "--eol", "--resource-path", "--extract-media", "--raw-content", "--pdf-engine", "--pdf-font", "--pdf-page", "--pdf-page-size", "--pdf-orientation", "--pdf-margin", "--pdf-font-size", "--pdf-line-height", "--epub-title", "--epub-language", "--epub-identifier", "--epub-chapter-level"]);
  const paths: string[] = [], explicit: string[] = [], defaults: string[] = [], inputs: string[] = [];
  const aliases = new Map([["-f", "from"], ["-r", "from"], ["--read", "from"], ["-t", "to"], ["-w", "to"], ["--write", "to"], ["-o", "output"], ["-s", "standalone"], ["-N", "number-sections"], ["--table-of-contents", "toc"]]);
  const canonical = (flag: string) => {
    const name = flag.length > 2 && ["-f", "-r", "-t", "-w", "-o"].includes(flag.slice(0, 2)) ? flag.slice(0, 2) : flag;
    return aliases.get(name) ?? (name.startsWith("--") ? name.slice(2) : name);
  };
  try {
    let positional = false;
    for (let i = 0; i < args.length; i++) {
      execution.checkpoint();
      const arg = args[i]!;
      if (arg === "--") positional = true;
      const name = arg.split("=")[0];
      if (!positional && (name === "--defaults" || name === "-d" || arg.startsWith("-d") && arg.length > 2)) {
        const path = arg.startsWith("-d") && arg.length > 2 && arg[2] !== "=" ? arg.slice(2) : arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[++i];
        if (!path || path.startsWith("-") || !files.readFile) execution.fail("E_OPTION", "Defaults require a path and explicit readFile capability");
        paths.push(path!);
      } else {explicit.push(arg); if (!positional && valueFlags.has(arg) && i + 1 < args.length) explicit.push(args[++i]!);}
    }
    const flags = new Set<string>();
    positional = false;
    for (let i = 0; i < explicit.length; i++) {const arg = explicit[i]!; if (arg === "--") positional = true; if (!positional && arg.startsWith("-")) {flags.add(canonical(arg.split("=")[0]!)); if (valueFlags.has(arg)) i++;}}
    const scalars = new Set(["from", "to", "output", "template", "standalone", "wrap", "columns", "number-sections", "toc", "table-of-contents", "strip-comments", "ascii", "shift-heading-level-by", "eol", "file-scope", "sandbox", "fail-if-warnings"]);
    const lists = new Set(["include-in-header", "include-before-body", "include-after-body", "metadata-file", "input-files"]);
    const merged = new Map<string, unknown>();
    const mergeMaps = async (previous: Record<string, unknown>, next: Record<string, unknown>, depth = 0): Promise<Record<string, unknown>> => {
      execution.bound("depth", depth);
      const result = {...previous};
      for (const [key, value] of Object.entries(next)) {
        await execution.cooperate();
        if (["__proto__", "constructor", "prototype"].includes(key)) execution.fail("E_OPTION", "Unsafe defaults map key");
        const old = result[key];
        result[key] = old && value && typeof old === "object" && typeof value === "object" && !Array.isArray(old) && !Array.isArray(value)
          ? await mergeMaps(old as Record<string, unknown>, value as Record<string, unknown>, depth + 1) : value;
      }
      return result;
    };
    for (const path of paths) {
      execution.charge("includes", 1);
      const bytes = await execution.acquire((async function* () {yield await files.readFile!(path, signal, execution.remaining("inputBytes"));})(), "resourceBytes");
      const text = await execution.decodeUtf8([bytes]);
      execution.checkpoint(text.length);
      const document = parseDocument(text, {uniqueKeys: true});
      if (document.errors.length) execution.fail("E_OPTION", "Invalid YAML defaults");
      let value: unknown;
      try {value = document.toJS({maxAliasCount: 0});} catch {execution.fail("E_OPTION", "YAML defaults aliases are unsupported");}
      if (!value || typeof value !== "object" || Array.isArray(value)) execution.fail("E_OPTION", "Defaults must be a YAML map");
      for (const [raw, entry] of Object.entries(value as Record<string, unknown>)) {
        execution.checkpoint();
        const key = raw === "reader" ? "from" : raw === "writer" ? "to" : raw === "output-file" ? "output" : raw === "table-of-contents" ? "toc" : raw;
        if (!scalars.has(key) && !lists.has(key) && key !== "variables" && key !== "metadata") execution.fail("E_OPTION", `Unsupported defaults key: ${raw}`);
        if (lists.has(key)) merged.set(key, [...(merged.get(key) as unknown[] ?? []), ...(Array.isArray(entry) ? entry : [entry])]);
        else if (key === "variables" || key === "metadata") {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) execution.fail("E_OPTION", `${key} defaults must be a map`);
          await mergeJsonMetadata({}, entry as import("./types.js").MetadataObject, execution);
          merged.set(key, await mergeMaps(merged.get(key) as Record<string, unknown> ?? {}, entry as Record<string, unknown>));
        } else merged.set(key, entry);
      }
    }
    for (const [key, entry] of merged) {
      if (scalars.has(key)) {
        if (flags.has(key)) continue;
        if (typeof entry !== "string" && typeof entry !== "number" && typeof entry !== "boolean") execution.fail("E_OPTION", `Invalid defaults value: ${key}`);
        if (key === "file-scope" || key === "sandbox" || key === "fail-if-warnings") {if (typeof entry !== "boolean") execution.fail("E_OPTION", `Invalid boolean: ${key}`); if (entry) defaults.push(`--${key}`);}
        else defaults.push(`--${key}=${String(entry)}`);
      } else if (key === "metadata" || key === "variables") {
        for (const [name, value] of Object.entries(entry as object)) defaults.push(`--${key === "metadata" ? "metadata" : "variable-json"}=${name}:${JSON.stringify(value)}`);
      } else {
        for (const path of entry as unknown[]) {
          if (typeof path !== "string" || !path || key !== "input-files" && path.startsWith("-")) execution.fail("E_OPTION", `Invalid defaults path: ${key}`);
          if (key === "input-files") inputs.push(path);
          else defaults.push(`--${key}=${path}`);
        }
      }
    }
    const parsed = parseConversionArgs([...defaults, ...explicit], files, signal, inputs);
    const limits = {...execution.limits};
    for (const key of Object.keys(limits) as (keyof Limits)[]) limits[key] = execution.remaining(key);
    return {...parsed, defaultsPaths: paths, limits};
  } finally {await execution.close();}
}
