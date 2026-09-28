import { bytesFrom } from "safe-bash-byte-engine";
import { builtInDirectContextExecutors } from "safe-bash-io-engine/internal";
import { publicDiagnosticMessage } from "safe-bash-contracts/diagnostics";
import { createOutputOperation, writeBytes, type CommandDefinition, type OutputOperation, type VirtualShellPlugin } from "safe-bash-contracts";
import { escapeText } from "safe-bash-contracts/escaping";
import { Budget } from "./budget.js";
import { Inputs } from "./input.js";
import { argumentsFor, HtmlUsageError, settings, type HtmlToMarkdownCommandsOptions } from "./options.js";
import { Renderer } from "./render.js";
import type { HtmlToMarkdownLimits } from "./options.js";

export type { HtmlToMarkdownCommandsOptions, HtmlToMarkdownLimits } from "./options.js";

export function createHtmlToMarkdownCommand(options: HtmlToMarkdownCommandsOptions = {}): CommandDefinition {
  const configured = settings(options);
  const def: CommandDefinition = { name: "html-to-markdown", description: "Convert bounded VFS/stdin HTML to Markdown without fetching or executing", async execute(context) {
    context.signal.throwIfAborted();
    const profile = (context.capabilities?.commandLimits as { htmlToMarkdown?: Partial<HtmlToMarkdownLimits> } | undefined)?.htmlToMarkdown;
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
        let bytes = bytesFrom(text);
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
        blocks.push("#".repeat(lvl) + (inner ? .js" " + inner : ""));
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

export { evalSyncShuf } from "safe-bash-command-shuf";
