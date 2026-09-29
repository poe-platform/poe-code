import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  MdqError,
  parseMdqArguments,
  mdq,
  mdqCommand as rawMdqCommand,
  createMdqCommand as createRawMdqCommand,
  createMdqCommands as createRawMdqCommands,
  mdqCommands as rawMdqCommands,
  type MdqCommandsOptions,
} from "safe-bash-command-mdq";

builtInDirectContextExecutors.add(rawMdqCommand.execute);

export { MdqError, parseMdqArguments, mdq };
export * from "safe-bash-command-mdq";

export function createMdqCommand(options: MdqCommandsOptions = {}): CommandDefinition {
  const def = createRawMdqCommand(options);
  if (options.limits === undefined) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export const mdqCommand = createMdqCommand();

export function createMdqCommands(options: MdqCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawMdqCommands(options);
  if (options.limits === undefined) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
}

export function mdqCommands(options: MdqCommandsOptions = {}): VirtualShellPlugin {
  const plugin = rawMdqCommands(options);
  if (options.limits === undefined) {
    const defs = createMdqCommands(options);
    return {
      name: plugin.name,
      setup(host) {
        for (const cmd of defs) host.commands.register(cmd, { replace: options.replace ?? false });
      },
    };
  }
  return plugin;
}

const syncMdqDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

interface SyncMdNode {
  kind: "section" | "paragraph" | "code" | "list" | "item";
  level?: number;
  title?: string;
  text: string;
  language?: string;
  ordered?: boolean;
  index?: number;
  children: SyncMdNode[];
}

function parseSimpleMarkdownSync(source: string): SyncMdNode[] | undefined {
  if (source.includes("\r") || source.includes("\t") || source.includes("[^") || source.includes("![") || source.includes("]:")) return undefined;
  const rawLines = source.endsWith("\n") ? source.slice(0, -1).split("\n") : source.split("\n");
  if (rawLines[0]?.trim() === "---" || rawLines[0]?.trim() === "+++") return undefined;
  const blocks: SyncMdNode[] = [];
  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i]!;
    if (line.trim() === "") { i++; continue; }
    const hMatch = /^(#{1,6})\s+([^#*_`\[\]<>\\~]+)$/.exec(line);
    if (hMatch) {
      blocks.push({ kind: "section", level: hMatch[1]!.length, title: hMatch[2]!.trimEnd(), text: hMatch[2]!.trimEnd(), children: [] });
      i++;
      continue;
    }
    const fenceMatch = /^```([A-Za-z0-9_+-]*)$/.exec(line);
    if (fenceMatch) {
      const lang = fenceMatch[1] || undefined;
      i++;
      const codeLines: string[] = [];
      let closed = false;
      while (i < rawLines.length) {
        if (rawLines[i] === "```") { closed = true; i++; break; }
        codeLines.push(rawLines[i]!);
        i++;
      }
      if (!closed) return undefined;
      blocks.push({ kind: "code", text: codeLines.join("\n"), ...(lang ? { language: lang } : {}), children: [] });
      continue;
    }
    if (/^[-*]\s+[^#*_`\[\]<>\\~]+$/.test(line)) {
      const items: SyncMdNode[] = [];
      while (i < rawLines.length && /^[-*]\s+[^#*_`\[\]<>\\~]+$/.test(rawLines[i]!)) {
        const itemText = rawLines[i]!.replace(/^[-*]\s+/, "").trimEnd();
        if (itemText.startsWith("[")) return undefined;
        items.push({ kind: "item", ordered: false, text: itemText, children: [{ kind: "paragraph", text: itemText, children: [] }] });
        i++;
      }
      blocks.push({ kind: "list", ordered: false, text: "", children: items });
      continue;
    }
    if (/^[A-Za-z0-9 .,;:!?'"()-]+$/.test(line)) {
      const pLines: string[] = [];
      while (i < rawLines.length && rawLines[i]!.trim() !== "" && /^[A-Za-z0-9 .,;:!?'"()-]+$/.test(rawLines[i]!)) {
        pLines.push(rawLines[i]!.trimEnd());
        i++;
      }
      blocks.push({ kind: "paragraph", text: pLines.join("\n"), children: [] });
      continue;
    }
    return undefined;
  }
  const roots: SyncMdNode[] = [];
  const sectionStack: SyncMdNode[] = [];
  for (const b of blocks) {
    if (b.kind === "section") {
      while (sectionStack.length && sectionStack[sectionStack.length - 1]!.level! >= b.level!) sectionStack.pop();
      (sectionStack[sectionStack.length - 1]?.children ?? roots).push(b);
      sectionStack.push(b);
    } else {
      (sectionStack[sectionStack.length - 1]?.children ?? roots).push(b);
    }
  }
  return roots;
}

interface SyncMdSelector {
  kind: "section" | "code" | "item";
  min?: number | undefined;
  max?: number | undefined;
  needle: string;
  langNeedle?: string | undefined;
  ordered?: boolean | undefined;
}

function parseSimpleMdqQuery(query: string): SyncMdSelector[] | undefined {
  const parts = query.split("|").map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return [];
  const selectors: SyncMdSelector[] = [];
  for (const part of parts) {
    if (part.startsWith("#")) {
      let rest = part.slice(1);
      let min: number | undefined;
      let max: number | undefined;
      if (rest.startsWith("{")) {
        const close = rest.indexOf("}");
        if (close < 0) return undefined;
        const n = Number(rest.slice(1, close));
        if (!Number.isInteger(n) || n < 1 || n > 6) return undefined;
        min = max = n;
        rest = rest.slice(close + 1);
      }
      if (rest.length > 0 && !rest.startsWith(" ")) return undefined;
      const needle = rest.trim();
      if (needle.length > 0 && !/^[A-Za-z0-9 _-]+$/.test(needle)) return undefined;
      selectors.push({ kind: "section", ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }), needle: needle.toLowerCase() });
    } else if (part.startsWith("```")) {
      const rest = part.slice(3);
      if (rest.includes(" ") || !/^[A-Za-z0-9_+-]*$/.test(rest)) return undefined;
      selectors.push({ kind: "code", needle: "", langNeedle: rest.toLowerCase() });
    } else if (part === "-" || part.startsWith("- ")) {
      const needle = part.slice(1).trim();
      if (needle.length > 0 && !/^[A-Za-z0-9 _-]+$/.test(needle)) return undefined;
      selectors.push({ kind: "item", ordered: false, needle: needle.toLowerCase() });
    } else {
      return undefined;
    }
  }
  return selectors;
}

function renderMdNodeMarkdown(n: SyncMdNode): string {
  if (n.kind === "section") {
    const head = "#".repeat(n.level!) + " " + n.title!;
    if (n.children.length === 0) return head;
    return head + "\n\n" + n.children.map(renderMdNodeMarkdown).join("\n\n");
  }
  if (n.kind === "code") {
    return "```" + (n.language ?? "") + "\n" + n.text + "\n```";
  }
  if (n.kind === "paragraph") return n.text;
  if (n.kind === "list") {
    return n.children.map(c => "- " + c.text).join("\n");
  }
  if (n.kind === "item") return "- " + n.text;
  return "";
}

function renderMdNodePlain(n: SyncMdNode): string {
  if (n.kind === "section") {
    const parts = [n.title!];
    for (const c of n.children) parts.push(renderMdNodePlain(c));
    return parts.join("\n");
  }
  if (n.kind === "code" || n.kind === "paragraph" || n.kind === "item") return n.text;
  if (n.kind === "list") return n.children.map(c => c.text).join("\n");
  return "";
}

let lastMdqText: string | undefined;
let lastMdqRoots: SyncMdNode[] | undefined;

export function evalSyncMdq(
  inBytes: Uint8Array,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  if (inBytes.byteLength > 8192 || opArgs.length > 6) return undefined;
  let format: "markdown" | "plain" = "markdown";
  let quiet = false;
  let ended = false;
  const positional: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (!ended && a === "--") { ended = true; continue; }
    if (!ended && (a === "-o" || a === "--output" || a.startsWith("--output="))) {
      const v = a.startsWith("--output=") ? a.slice(9) : opArgs[++i];
      if (v === "plain") format = "plain";
      else if (v === "md" || v === "markdown") format = "markdown";
      else return undefined;
      continue;
    }
    if (!ended && (a === "-q" || a === "--quiet")) { quiet = true; continue; }
    if (!ended && a.startsWith("-") && a !== "-") return undefined;
    positional.push(a);
  }
  const queryStr = positional[0] ?? "";
  const files = positional.slice(1);
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
    text = syncMdqDecoder.decode(srcBytes);
  } catch {
    return undefined;
  }
  const selectors = parseSimpleMdqQuery(queryStr);
  if (!selectors) return undefined;
  let roots: SyncMdNode[] | undefined;
  if (text === lastMdqText && lastMdqRoots !== undefined) {
    roots = lastMdqRoots;
  } else {
    roots = parseSimpleMarkdownSync(text);
    if (!roots) return undefined;
    lastMdqText = text;
    lastMdqRoots = roots;
  }
  let nodes: SyncMdNode[] = [{ kind: "section", level: 0, title: "", text: "", children: roots }];
  for (const s of selectors) {
    const out: SyncMdNode[] = [];
    const pending = nodes.slice().reverse();
    while (pending.length) {
      const n = pending.pop()!;
      let hit = false;
      if (s.kind === n.kind && n.level !== 0) {
        if (n.kind === "section") {
          hit = (s.min === undefined || n.level! >= s.min) &&
            (s.max === undefined || n.level! <= s.max) &&
            (s.needle === "" || n.title!.toLowerCase().includes(s.needle));
        } else if (n.kind === "code") {
          hit = s.langNeedle === "" || (n.language ?? "").toLowerCase().includes(s.langNeedle!);
        } else if (n.kind === "item") {
          hit = s.ordered === Boolean(n.ordered) && (s.needle === "" || n.text.toLowerCase().includes(s.needle));
        }
      }
      if (hit) {
        out.push(n.kind === "item" ? { kind: "list", ordered: false, text: "", children: [n] } : n);
        continue;
      }
      for (let i = n.children.length - 1; i >= 0; i--) pending.push(n.children[i]!);
    }
    nodes = out;
  }
  if (nodes.length === 0) return undefined;
  if (quiet) return "";
  if (format === "plain") {
    return nodes.map(renderMdNodePlain).join("\n") + "\n";
  }
  return nodes.map(renderMdNodeMarkdown).join("\n\n   -----\n\n") + "\n";
}
