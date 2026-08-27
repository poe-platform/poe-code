import { writeBytes, type CommandDefinition, type VirtualShellPlugin } from "../../contracts/index.js";
import { Budget } from "./budget.js";
import { Inputs } from "./input.js";
import { argumentsFor, HtmlUsageError, settings, type HtmlToMarkdownCommandsOptions } from "./options.js";
import { Renderer } from "./render.js";

export type { HtmlToMarkdownCommandsOptions, HtmlToMarkdownLimits } from "./options.js";

export function createHtmlToMarkdownCommand(options: HtmlToMarkdownCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return { name: "html-to-markdown", description: "Convert bounded VFS/stdin HTML to Markdown without fetching or executing", async execute(context) {
    context.signal.throwIfAborted();
    const budget = new Budget(context, limits);
    let inputs: Inputs | undefined, failed = false;
    try {
      const parsed = argumentsFor(context.args, limits);
      if (parsed.info !== undefined) { await budget.emit(parsed.info); return { exitCode: 0 }; }
      inputs = new Inputs(context, budget);
      const renderer = new Renderer(budget);
      let written = false;
      for (const name of parsed.files) {
        const markdown = await renderer.document(await inputs.document(name));
        if (!markdown) continue;
        if (written) await budget.emit("\n");
        await budget.emit(markdown); written = true;
      }
      return { exitCode: 0 };
    } catch (error) {
      failed = true;
      inputs?.preservePrimaryFailure();
      context.signal.throwIfAborted();
      const message = error instanceof Error ? error.message : String(error);
      const text = `html-to-markdown: ${message.slice(0, limits.maxDiagnosticBytes)}\n`;
      let bytes = Buffer.from(text);
      if (bytes.length > limits.maxDiagnosticBytes) {
        let end = limits.maxDiagnosticBytes;
        while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
        bytes = bytes.subarray(0, end);
      }
      await writeBytes(context.stderr, bytes, context.signal);
      return { exitCode: error instanceof HtmlUsageError ? 2 : 1 };
    } finally {
      try { await inputs?.close(); }
      catch (error) { context.signal.throwIfAborted(); if (!failed) throw error; }
      context.signal.throwIfAborted();
    }
  } };
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
