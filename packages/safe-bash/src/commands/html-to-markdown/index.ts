import { builtInDirectContextExecutors } from "../internal.js";
import { publicDiagnosticMessage } from "../../diagnostics.js";
import { createOutputOperation, writeBytes, type CommandDefinition, type OutputOperation, type VirtualShellPlugin } from "../../contracts/index.js";
import { escapeText } from "../../escaping.js";
import { Budget } from "./budget.js";
import { Inputs } from "./input.js";
import { argumentsFor, HtmlUsageError, settings, type HtmlToMarkdownCommandsOptions } from "./options.js";
import { Renderer } from "./render.js";
import type { CommandFamilyLimits } from "../limits.js";
import type { HtmlToMarkdownLimits } from "./options.js";

export type { HtmlToMarkdownCommandsOptions, HtmlToMarkdownLimits } from "./options.js";

export function createHtmlToMarkdownCommand(options: HtmlToMarkdownCommandsOptions = {}): CommandDefinition {
  const configured = settings(options);
  const def: CommandDefinition = { name: "html-to-markdown", description: "Convert bounded VFS/stdin HTML to Markdown without fetching or executing", async execute(context) {
    context.signal.throwIfAborted();
    const profile = (context.capabilities?.commandLimits as CommandFamilyLimits | undefined)?.htmlToMarkdown;
    const limits = { ...configured };
    if (profile) {
      settings({ limits: profile });
      for (const key of Object.keys(profile) as (keyof HtmlToMarkdownLimits)[]) limits[key] = Math.min(limits[key], profile[key]!);
    }
    let operation: OutputOperation | undefined;
    let inputs: Inputs | undefined, failed = false;
    let rejected = false, failure: unknown;
    let result = { exitCode: 0 };
    try {
      const parsed = argumentsFor(context.args, limits);
      operation = createOutputOperation(context, context.stdout);
      const work = { ...context, signal: operation.signal, stdout: operation.output, registerCleanup: operation.registerCleanup };
      const budget = new Budget(work, limits);
      if (parsed.info !== undefined) await budget.emit(parsed.info);
      else {
        inputs = new Inputs(work, budget);
        const renderer = new Renderer(budget);
        let written = false;
        for (const name of parsed.files) {
          const markdown = await renderer.document(await inputs.document(name));
          if (!markdown) continue;
          if (written) await budget.emit("\n");
          await budget.emit(markdown); written = true;
        }
      }
    } catch (error) {
      failed = true;
      inputs?.preservePrimaryFailure();
      try {
        context.signal.throwIfAborted();
        if (operation?.signal.aborted && error === operation.signal.reason) throw error;
        const message = error instanceof HtmlUsageError ? error.message : publicDiagnosticMessage(error, context.onInternalError);
        const text = `html-to-markdown: ${escapeText(message.slice(0, limits.maxDiagnosticBytes), "diagnostic")}\n`;
        let bytes = Buffer.from(text);
        if (bytes.length > limits.maxDiagnosticBytes) {
          let end = limits.maxDiagnosticBytes;
          while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
          bytes = bytes.subarray(0, end);
        }
        await writeBytes(context.stderr, bytes, context.signal);
        result = { exitCode: error instanceof HtmlUsageError ? 2 : 1 };
      } catch (error) {
        rejected = true; failure = error;
      }
    }
    for (const cleanup of [inputs?.close, operation?.close]) {
      try { await cleanup?.(); }
      catch (error) { if (!failed && !rejected) { rejected = true; failure = error; } }
    }
    context.signal.throwIfAborted();
    if (rejected) throw failure;
    return result;
  } };
  if (options.limits === undefined) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createHtmlToMarkdownCommands(options: HtmlToMarkdownCommandsOptions = {}): readonly CommandDefinition[] {
  return [createHtmlToMarkdownCommand(options)];
}

export function htmlToMarkdownCommands(options: HtmlToMarkdownCommandsOptions = {}): VirtualShellPlugin {
  const commands = createHtmlToMarkdownCommands(options), replace = options.replace ?? false;
  return { name: "html-to-markdown-commands", setup(host) {
    if (!replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    for (const command of commands) host.commands.register(command, { replace });
  } };
}

const syncHtmlMdDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
let lastHtmlMdInput: string | undefined;
let lastHtmlMdOutput: string | undefined;

function convertSimpleInlineHtmlSync(html: string): string | undefined {
  if (html.includes("&")) return undefined;
  let out = html;
  out = out.replace(/<(strong|b)>([^<>]+)<\/\1>/g, "**$2**");
  out = out.replace(/<(em|i)>([^<>]+)<\/\1>/g, "*$2*");
  out = out.replace(/<(del|s)>([^<>]+)<\/\1>/g, "~~$2~~");
  out = out.replace(/<code>([^<>\x60]+)<\/code>/g, "`$1`");
  out = out.replace(/<a\s+href="([^"\s<>]+)">([^<>\]\[]+)<\/a>/g, "[$2]($1)");
  if (out.includes("<") || out.includes(">")) return undefined;
  return out.replace(/[ \t\r\n]+/g, " ").trim();
}

export function evalSyncHtmlToMarkdown(
  inBytes: Uint8Array,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  if (inBytes.byteLength > 8192 || opArgs.length > 3) return undefined;
  let ended = false;
  const files: string[] = [];
  for (const a of opArgs) {
    if (!ended && a === "--") { ended = true; continue; }
    if (!ended && a.startsWith("-") && a !== "-") return undefined;
    files.push(a);
  }
  if (files.length > 1) return undefined;
  let srcBytes = inBytes;
  if (files.length === 1 && files[0] !== "-") {
    if (!readFileSync) return undefined;
    const fBytes = readFileSync(files[0]!);
    if (!fBytes || fBytes.byteLength > 8192) return undefined;
    srcBytes = fBytes;
  }
  let html: string;
  try {
    html = syncHtmlMdDecoder.decode(srcBytes);
  } catch {
    return undefined;
  }
  if (html === lastHtmlMdInput && lastHtmlMdOutput !== undefined) {
    return lastHtmlMdOutput;
  }
  if (html.includes("&") || html.includes("<!--") || html.includes("<![")) return undefined;
  const trimmed = html.trim();
  if (trimmed === "") return "";
  const blockRe = /^\s*(?:<(h[1-6]|p)>([\s\S]*?)<\/\1>|<ul>([\s\S]*?)<\/ul>|<ol>([\s\S]*?)<\/ol>)\s*/;
  let rest = trimmed;
  const blocks: string[] = [];
  while (rest.length > 0) {
    const m = blockRe.exec(rest);
    if (!m) return undefined;
    rest = rest.slice(m[0].length);
    if (m[1]) {
      const tag = m[1];
      const inner = convertSimpleInlineHtmlSync(m[2]!);
      if (inner === undefined) return undefined;
      if (tag.startsWith("h")) {
        const lvl = Number(tag.slice(1));
        blocks.push("#".repeat(lvl) + (inner ? " " + inner : ""));
      } else {
        if (inner) blocks.push(inner);
      }
    } else if (m[3] !== undefined || m[4] !== undefined) {
      const ordered = m[4] !== undefined;
      const listBody = (m[3] ?? m[4])!.trim();
      const liRe = /^\s*<li>([\s\S]*?)<\/li>\s*/;
      let lRest = listBody;
      const items: string[] = [];
      let idx = 1;
      while (lRest.length > 0) {
        const lm = liRe.exec(lRest);
        if (!lm) return undefined;
        lRest = lRest.slice(lm[0].length);
        const itemText = convertSimpleInlineHtmlSync(lm[1]!);
        if (itemText === undefined) return undefined;
        items.push((ordered ? `${idx++}. ` : "- ") + itemText);
      }
      if (items.length === 0) return undefined;
      blocks.push(items.join("\n"));
    }
  }
  const result = blocks.length > 0 ? blocks.join("\n\n") + "\n" : "";
  lastHtmlMdInput = html;
  lastHtmlMdOutput = result;
  return result;
}

const syncShufDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const shufWordMax = (1n << 64n) - 1n;
const shufRngPool = new Uint8Array(4096);
let shufRngOffset = 4096;

export function evalSyncShuf(
  inBytes: Uint8Array,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  if (inBytes.byteLength > 8192 || opArgs.length > 64) return undefined;
  let echo = false;
  let repeat = false;
  let count: number | undefined;
  let rangeLow: number | undefined;
  let rangeSize: number | undefined;
  let randomFile: string | undefined;
  let ended = false;
  const operands: string[] = [];

  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (!ended && a === "--") { ended = true; continue; }
    if (!ended && a.startsWith("-") && a !== "-") {
      if (a === "-e" || a === "--echo") { echo = true; continue; }
      if (a === "-r" || a === "--repeat") { repeat = true; continue; }
      if (a === "-n" || a === "--head-count" || a.startsWith("-n") || a.startsWith("--head-count=")) {
        const v = a.startsWith("--head-count=") ? a.slice(13) : a.length > 2 && a.startsWith("-n") ? a.slice(2) : opArgs[++i];
        if (!v || !/^[0-9]{1,6}$/.test(v)) return undefined;
        const n = Number(v);
        if (count === undefined || n < count) count = n;
        continue;
      }
      if (a === "-i" || a === "--input-range" || a.startsWith("-i") || a.startsWith("--input-range=")) {
        if (rangeLow !== undefined) return undefined;
        const v = a.startsWith("--input-range=") ? a.slice(14) : a.length > 2 && a.startsWith("-i") ? a.slice(2) : opArgs[++i];
        if (!v) return undefined;
        const m = /^([0-9]{1,7})-([0-9]{1,7})$/.exec(v);
        if (!m) return undefined;
        const lo = Number(m[1]!);
        const hi = Number(m[2]!);
        if (hi < lo || hi - lo + 1 > 1024) return undefined;
        rangeLow = lo;
        rangeSize = hi - lo + 1;
        continue;
      }
      if (a === "--random-source" || a.startsWith("--random-source=")) {
        const v = a.startsWith("--random-source=") ? a.slice(16) : opArgs[++i];
        if (!v || (randomFile !== undefined && randomFile !== v)) return undefined;
        randomFile = v;
        continue;
      }
      return undefined;
    }
    operands.push(a);
  }

  if (echo && rangeLow !== undefined) return undefined;
  if (rangeLow !== undefined && operands.length > 0) return undefined;
  if (!echo && rangeLow === undefined && operands.length > 1) return undefined;

  let lines: string[] = [];
  let size = 0;
  if (count === 0) {
    return "";
  }
  if (echo) {
    if (operands.length > 1024) return undefined;
    lines = operands.slice();
    size = lines.length;
  } else if (rangeLow !== undefined) {
    size = rangeSize!;
  } else {
    if (operands.length === 0 || operands[0] === "-") {
      if (inBytes.byteLength === 0) return undefined;
    }
    let srcBytes = inBytes;
    if (operands.length === 1 && operands[0] !== "-") {
      if (!readFileSync) return undefined;
      const fBytes = readFileSync(operands[0]!);
      if (!fBytes || fBytes.byteLength > 8192) return undefined;
      srcBytes = fBytes;
    }
    if (srcBytes.includes(0)) return undefined;
    let text: string;
    try {
      text = syncShufDecoder.decode(srcBytes);
    } catch {
      return undefined;
    }
    if (text.length > 0) {
      lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
      if (lines.length > 1024) return undefined;
    }
    size = lines.length;
  }

  if (repeat && size === 0 && (count === undefined || count > 0)) return undefined;
  const ahead = repeat ? (count ?? 1025) : count !== undefined && count < size ? count : size;
  if (ahead > 1024) return undefined;
  if (ahead === 0) return "";

  let randBytes: Uint8Array | undefined;
  let randOff = 0;
  if (randomFile !== undefined) {
    if (!readFileSync) return undefined;
    randBytes = readFileSync(randomFile);
    if (!randBytes) return undefined;
  }

  let rVal = 0n;
  let rMax = 0n;
  const choose = (szNum: number): number | undefined => {
    const sz = BigInt(szNum);
    const target = sz - 1n;
    while (true) {
      while (rMax < target) {
        let b: number;
        if (randBytes !== undefined) {
          if (randOff >= randBytes.length) return undefined;
          b = randBytes[randOff++]!;
        } else {
          if (shufRngOffset >= shufRngPool.length) {
            globalThis.crypto.getRandomValues(shufRngPool);
            shufRngOffset = 0;
          }
          b = shufRngPool[shufRngOffset++]!;
        }
        rVal = ((rVal << 8n) + BigInt(b)) & shufWordMax;
        rMax = ((rMax << 8n) + 255n) & shufWordMax;
      }
      if (rMax === target) {
        const chosen = Number(rVal);
        rVal = rMax = 0n;
        return chosen;
      }
      const excess = rMax - target;
      const unusable = excess % sz;
      const remainder = rVal % sz;
      if (rVal <= rMax - unusable) {
        rVal /= sz;
        rMax = excess / sz;
        return Number(remainder);
      }
      rVal = remainder;
      rMax = unusable - 1n;
    }
  };

  const out: string[] = [];
  const swaps = new Map<number, number>();
  for (let idx = 0; idx < ahead; idx++) {
    let chosen: number;
    if (repeat) {
      const c = choose(size);
      if (c === undefined) return undefined;
      chosen = c;
    } else {
      const c = choose(size - idx);
      if (c === undefined) return undefined;
      const pick = idx + c;
      chosen = swaps.get(pick) ?? pick;
      swaps.set(pick, swaps.get(idx) ?? idx);
      swaps.delete(idx);
    }
    out.push(rangeLow !== undefined ? String(rangeLow + chosen) : lines[chosen]!);
  }
  return out.join("\n") + "\n";
}
