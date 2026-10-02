import {
  createYqCommand as createRawYqCommand,
  createYqCommands as createRawYqCommands,
  yqCommands as rawYqCommands,
  type YqCommandsOptions,
} from "safe-bash-command-yq";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { registerDefaultExecutor, registerDefaultExecutors } from "../internal.js";
export * from "safe-bash-command-yq";

export function createYqCommand(options: YqCommandsOptions = {}): CommandDefinition {
  return registerDefaultExecutor(createRawYqCommand(options), options);
}

export function createYqCommands(options: YqCommandsOptions = {}): readonly CommandDefinition[] {
  return registerDefaultExecutors(createRawYqCommands(options), options);
}

export function yqCommands(options: YqCommandsOptions = {}): VirtualShellPlugin {
  const commands = createYqCommands(options);
  const base = rawYqCommands(options);
  return {
    ...base,
    setup(host) {
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}

const syncYqDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function parseSimpleYamlScalar(raw: string): unknown {
  const s = raw.trim();
  if (s === "" || s === "null" || s === "~" || s === "Null" || s === "NULL") return null;
  if (s === "true" || s === "True" || s === "TRUE") return true;
  if (s === "false" || s === "False" || s === "FALSE") return false;
  if (/^[+-]?[0-9]+$/.test(s)) {
    const n = Number(s);
    if (Number.isSafeInteger(n)) return n;
  }
  if (/^[+-]?(?:[0-9]+\.[0-9]+|\.[0-9]+)$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  if ((s.startsWith("\"") && s.endsWith("\"")) || (s.startsWith("\x27") && s.endsWith("\x27"))) {
    if (s.startsWith("\"")) {
      try { return JSON.parse(s); } catch { return undefined; }
    }
    return s.slice(1, -1).replaceAll("\x27\x27", "\x27");
  }
  if (/[\[\]{}&*!|>%@`]/.test(s)) return undefined;
  return s;
}

function parseSimpleYamlOrToml(text: string, format: "yaml" | "toml"): unknown {
  // Quoted hashes need the full YAML/TOML parser before comment removal.
  for (const line of text.split("\n")) {
    if (line.includes("#") && (line.includes('"') || line.includes("'"))) return undefined;
  }
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (format === "yaml" && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
    try { return JSON.parse(trimmed); } catch { /* fall through */ }
  }
  if (format === "toml") {
    const root: Record<string, unknown> = {};
    let cur = root;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, "").trim();
      if (!line) continue;
      if (line.startsWith("[[")) return undefined;
      if (line.startsWith("[") && line.endsWith("]")) {
        const sec = line.slice(1, -1).trim();
        if (!/^[A-Za-z0-9_.-]+$/.test(sec)) return undefined;
        cur = root;
        for (const part of sec.split(".")) {
          if (typeof cur[part] !== "object" || cur[part] === null || Array.isArray(cur[part])) cur[part] = {};
          cur = cur[part] as Record<string, unknown>;
        }
        continue;
      }
      const eq = line.indexOf("=");
      if (eq <= 0) return undefined;
      const k = line.slice(0, eq).trim();
      const vRaw = line.slice(eq + 1).trim();
      if (!/^[A-Za-z0-9_-]+$/.test(k)) return undefined;
      const v = parseSimpleYamlScalar(vRaw);
      if (v === undefined) return undefined;
      cur[k] = v;
    }
    return root;
  }
  // Simple block YAML parser (mappings & sequences)
  const lines: { indent: number; text: string }[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.includes("\t")) return undefined;
    const noComment = rawLine.replace(/(^|\s)#.*$/, "");
    const t = noComment.trim();
    if (!t || t === "---" || t === "...") continue;
    let indent = 0;
    while (indent < noComment.length && noComment[indent] === " ") indent++;
    lines.push({ indent, text: t });
  }
  if (lines.length === 0) return null;
  let idx = 0;
  function parseBlock(baseIndent: number): unknown {
    if (idx >= lines.length) return null;
    if (lines[idx]!.text.startsWith("- ") || lines[idx]!.text === "-") {
      const arr: unknown[] = [];
      while (idx < lines.length && lines[idx]!.indent === baseIndent) {
        const l = lines[idx]!.text;
        if (!l.startsWith("-") || (l.length > 1 && l[1] !== " ")) return undefined;
        const rest = l.slice(1).trim();
        idx++;
        if (!rest) {
          if (idx < lines.length && lines[idx]!.indent > baseIndent) {
            const sub = parseBlock(lines[idx]!.indent);
            if (sub === undefined) return undefined;
            arr.push(sub);
          } else arr.push(null);
        } else if (rest.includes(": ") || rest.endsWith(":")) {
          const colon = rest.indexOf(":");
          const key = rest.slice(0, colon).trim();
          const valRest = rest.slice(colon + 1).trim();
          if (!/^[A-Za-z0-9_.-]+$/.test(key)) return undefined;
          const itemObj: Record<string, unknown> = {};
          if (!valRest) {
            if (idx < lines.length && lines[idx]!.indent > baseIndent + 2) {
              const sub = parseBlock(lines[idx]!.indent);
              if (sub === undefined) return undefined;
              itemObj[key] = sub;
            } else {
              itemObj[key] = null;
            }
          } else {
            const parsedVal = parseSimpleYamlScalar(valRest);
            if (parsedVal === undefined) return undefined;
            itemObj[key] = parsedVal;
          }
          const propIndent = baseIndent + 2;
          while (idx < lines.length && lines[idx]!.indent === propIndent && !lines[idx]!.text.startsWith("-")) {
            const pl = lines[idx]!.text;
            const pColon = pl.indexOf(":");
            if (pColon <= 0) return undefined;
            const pKey = pl.slice(0, pColon).trim();
            const pRest = pl.slice(pColon + 1).trim();
            if (!/^[A-Za-z0-9_.-]+$/.test(pKey)) return undefined;
            idx++;
            if (!pRest) {
              if (idx < lines.length && lines[idx]!.indent > propIndent) {
                const sub = parseBlock(lines[idx]!.indent);
                if (sub === undefined) return undefined;
                itemObj[pKey] = sub;
              } else {
                itemObj[pKey] = null;
              }
            } else {
              const pv = parseSimpleYamlScalar(pRest);
              if (pv === undefined) return undefined;
              itemObj[pKey] = pv;
            }
          }
          arr.push(itemObj);
        } else {
          const val = parseSimpleYamlScalar(rest);
          if (val === undefined) return undefined;
          arr.push(val);
        }
      }
      return arr;
    }
    const obj: Record<string, unknown> = {};
    while (idx < lines.length && lines[idx]!.indent === baseIndent) {
      const l = lines[idx]!.text;
      const colon = l.indexOf(":");
      if (colon <= 0) return undefined;
      const key = l.slice(0, colon).trim();
      const rest = l.slice(colon + 1).trim();
      if (!/^[A-Za-z0-9_.-]+$/.test(key)) return undefined;
      idx++;
      if (!rest) {
        if (idx < lines.length && lines[idx]!.indent > baseIndent) {
          const sub = parseBlock(lines[idx]!.indent);
          if (sub === undefined) return undefined;
          obj[key] = sub;
        } else {
          obj[key] = null;
        }
      } else {
        const val = parseSimpleYamlScalar(rest);
        if (val === undefined) return undefined;
        obj[key] = val;
      }
    }
    return obj;
  }
  const parsed = parseBlock(lines[0]!.indent);
  if (idx !== lines.length) return undefined;
  return parsed;
}

let lastYqText: string | undefined;
let lastYqInputFormat: "yaml" | "toml" | undefined;
let lastYqJsonStr: string | undefined;

export function evalSyncYqPrep(
  inBytes: Uint8Array,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): { jsonStr: string; jqArgs: string[]; format: "yaml" | "json" } | undefined {
  if (inBytes.byteLength > 8192 || opArgs.length > 14) return undefined;
  let nullInput = false;
  const extraJqArgs: string[] = [];
  let idx = opArgs[0] === "eval" || opArgs[0] === "e" ? 1 : 0;
  if (opArgs[0] === "eval-all" || opArgs[0] === "ea") return undefined;
  let ended = false;
  let inputFormat: "yaml" | "toml" = "yaml";
  let format: "yaml" | "json" = "yaml";
  let explicitJson = false;
  let compact = false;
  let raw = false;
  const operands: string[] = [];
  for (; idx < opArgs.length; idx++) {
    const a = opArgs[idx]!;
    if (!ended && a === "--") { ended = true; continue; }
    if (!ended && (a === "-p" || a.startsWith("-p") || a === "--input-format" || a.startsWith("--input-format="))) {
      const v = a.startsWith("--input-format=") ? a.slice(15) : a.startsWith("-p=") ? a.slice(3) : a.length > 2 && a.startsWith("-p") ? a.slice(2) : opArgs[++idx];
      if (v !== "yaml" && v !== "toml") return undefined;
      inputFormat = v;
      continue;
    }
    if (!ended && (a === "-o" || a.startsWith("-o") || a === "--output-format" || a.startsWith("--output-format="))) {
      const v = a.startsWith("--output-format=") ? a.slice(16) : a.startsWith("-o=") ? a.slice(3) : a.length > 2 && a.startsWith("-o") ? a.slice(2) : opArgs[++idx];
      if (v !== "yaml" && v !== "json") return undefined;
      format = v;
      explicitJson = v === "json";
      continue;
    }
    if (!ended && (a === "-c" || a === "--compact-output")) { compact = true; continue; }
    if (!ended && (a === "-r" || a === "--unwrapScalar")) { raw = true; continue; }
    if (!ended && (a === "-n" || a === "--null-input")) { nullInput = true; continue; }
    if (!ended && (a === "--arg" || a === "--argjson")) {
      if (idx + 2 >= opArgs.length) return undefined;
      extraJqArgs.push(a, opArgs[idx + 1]!, opArgs[idx + 2]!);
      idx += 2;
      continue;
    }
    if (!ended && a.startsWith("-") && a !== "-") return undefined;
    operands.push(a);
  }
  if (!explicitJson) return undefined;
  const filter = operands[0] ?? ".";
  const files = operands.slice(1);
  if (files.length > 1) return undefined;
  let srcBytes = inBytes;
  if (files.length === 1 && files[0] !== "-") {
    if (!readFileSync) return undefined;
    const fBytes = readFileSync(files[0]!);
    if (!fBytes || fBytes.byteLength > 8192) return undefined;
    srcBytes = fBytes;
  }
  let text: string;
  try {
    text = syncYqDecoder.decode(srcBytes);
  } catch {
    return undefined;
  }
  let jsonStr: string;
  if (nullInput) {
    jsonStr = "null";
  } else if (text === lastYqText && inputFormat === lastYqInputFormat && lastYqJsonStr !== undefined) {
    jsonStr = lastYqJsonStr;
  } else {
    const doc = parseSimpleYamlOrToml(text, inputFormat);
    if (doc === undefined) return undefined;
    jsonStr = JSON.stringify(doc);
    lastYqText = text;
    lastYqInputFormat = inputFormat;
    lastYqJsonStr = jsonStr;
  }
  const jqArgs: string[] = [];
  if (format === "json") {
    if (raw && compact) jqArgs.push("-rc");
    else if (raw) jqArgs.push("-r");
    else if (compact) jqArgs.push("-c");
  } else {
    jqArgs.push("-c");
  }
  if (nullInput) jqArgs.push("-n");
  jqArgs.push(...extraJqArgs, filter);
  return { jsonStr, jqArgs, format };
}

function formatYamlScalarSync(val: unknown): string | undefined {
  if (val === null) return "null";
  if (typeof val === "boolean" || typeof val === "number") return String(val);
  if (typeof val === "string") {
    // Defer escapes whose canonical YAML spelling differs from JSON.
    for (const character of val) {
      const point = character.codePointAt(0)!;
      if (point === 0x1b || point === 0x7f || point >= 0x80 && point <= 0x9f || point === 0xfffe || point === 0xffff) return undefined;
    }
    return JSON.stringify(val);
  }
  return undefined;
}

function formatYamlNodeLinesSync(val: unknown, indent: string, out: string[]): boolean {
  const scalar = formatYamlScalarSync(val);
  if (scalar !== undefined) {
    out.push(`${indent}${scalar}`);
    return true;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) {
      out.push(`${indent}[]`);
      return true;
    }
    for (const item of val) {
      const s = formatYamlScalarSync(item);
      if (s !== undefined) {
        out.push(`${indent}- ${s}`);
      } else if (item && typeof item === "object" && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>);
        if (entries.length === 0) {
          out.push(`${indent}- {}`);
        } else {
          for (let i = 0; i < entries.length; i++) {
            const [k, v] = entries[i]!;
            const key = formatYamlScalarSync(k);
            if (key === undefined) return false;
            const prefix = i === 0 ? `${indent}- ` : `${indent}  `;
            const sv = formatYamlScalarSync(v);
            if (sv !== undefined || (Array.isArray(v) && v.length === 0) || (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as Record<string, unknown>).length === 0)) {
              const emptyCol = Array.isArray(v) ? "[]" : (v && typeof v === "object" ? "{}" : sv!);
              out.push(`${prefix}${key}: ${emptyCol}`);
            } else {
              out.push(`${prefix}${key}:`);
              if (!formatYamlNodeLinesSync(v, `${indent}    `, out)) return false;
            }
          }
        }
      } else {
        out.push(`${indent}-`);
        if (!formatYamlNodeLinesSync(item, `${indent}  `, out)) return false;
      }
    }
    return true;
  }
  if (typeof val === "object" && val !== null) {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0) {
      out.push(`${indent}{}`);
      return true;
    }
    for (const [k, v] of entries) {
      const key = formatYamlScalarSync(k);
      if (key === undefined) return false;
      const s = formatYamlScalarSync(v);
      if (s !== undefined || (Array.isArray(v) && v.length === 0) || (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as Record<string, unknown>).length === 0)) {
        const emptyCol = Array.isArray(v) ? "[]" : (v && typeof v === "object" ? "{}" : s!);
        out.push(`${indent}${key}: ${emptyCol}`);
      } else {
        out.push(`${indent}${key}:`);
        if (!formatYamlNodeLinesSync(v, `${indent}  `, out)) return false;
      }
    }
    return true;
  }
  return false;
}

export function formatSyncYqYamlLines(jsonLines: readonly string[]): string | undefined {
  const out: string[] = [];
  for (const line of jsonLines) {
    let val: unknown;
    try { val = JSON.parse(line); } catch { return undefined; }
    const document: string[] = [];
    if (!formatYamlNodeLinesSync(val, "", document)) return undefined;
    out.push(document.join("\n"));
  }
  return out.length === 0 ? "" : out.join("\n---\n") + "\n";
}

import { syncCommandEvaluators } from "../internal.js";
syncCommandEvaluators.evalSyncYqPrep = evalSyncYqPrep;
syncCommandEvaluators.formatSyncYqYamlLines = formatSyncYqYamlLines;
