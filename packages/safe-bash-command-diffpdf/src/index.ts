import type { PdfDocument } from "@poe-code/pdf-ast";
import { commandRuntimeIdentity, getCommandArguments, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { InputByteBudget, writeBytes } from "safe-bash-contracts/io";
import { resolvePath } from "safe-bash-contracts/path";
import { drainCooperativeSteps, yieldTurn } from "safe-bash-contracts/yield";

export interface DiffpdfLimits { readonly maxInputBytes: number; readonly maxPages: number }
export interface DiffpdfCommandsOptions { readonly limits?: Partial<DiffpdfLimits>; readonly replace?: boolean }

export function createDiffpdfCommand(options: DiffpdfCommandsOptions = {}): CommandDefinition {
  const maxInputBytes = InputByteBudget.limit(options.limits?.maxInputBytes ?? 32 * 1024 * 1024);
  const maxPages = InputByteBudget.limit(options.limits?.maxPages ?? 1000);
  return {
    name: "diffpdf", runtimeIdentity: commandRuntimeIdentity,
    async execute(context) {
      return new InputByteBudget(maxInputBytes, context.inputBudget).run(context, async context => {
        let mode: "text" | "layout" = "text";
        const files: string[] = []; let positional = false;
        for (const arg of getCommandArguments(context).args) {
          if (!positional && arg === "--") { positional = true; continue; }
          if (!positional && (arg === "--text" || arg === "--layout")) { mode = arg === "--text" ? "text" : "layout"; continue; }
          if (!positional && arg === "--help") {
            await writeBytes(context.stdout, new TextEncoder().encode("Usage: diffpdf [--text|--layout] OLD.pdf NEW.pdf\nExit 0: equal, 1: different, 2: invalid invocation.\n"), context.signal);
            return { exitCode: 0 };
          }
          if (!positional && arg.startsWith("-")) {
            await writeBytes(context.stderr, new TextEncoder().encode(`diffpdf: unsupported option ${arg}\n`), context.signal);
            return { exitCode: 2 };
          }
          files.push(arg);
        }
        if (files.length !== 2) {
          await writeBytes(context.stderr, new TextEncoder().encode("diffpdf: expected two PDF files\n"), context.signal);
          return { exitCode: 2 };
        }
        const { PdfDocument, PdfError } = await import("@poe-code/pdf-ast");
        const documents: PdfDocument[] = [];
        for (const file of files) {
          const bytes = await context.fs.readFile(resolvePath(context.cwd, file), { signal: context.signal });
          context.signal.throwIfAborted();
          let doc: PdfDocument;
          try {
            doc = await drainCooperativeSteps(PdfDocument.loadSteps(bytes), context.signal);
          } catch (error) {
            context.signal.throwIfAborted();
            if (!(error instanceof PdfError)) throw error;
            await writeBytes(context.stderr, new TextEncoder().encode(`diffpdf: ${file}: ${error.message}\n`), context.signal);
            return { exitCode: 2 };
          }
          if (doc.pageCount > maxPages) throw new RangeError("diffpdf: page limit exceeded");
          documents.push(doc);
        }
        const [a, b] = documents as [PdfDocument, PdfDocument];
        let changed = false;
        for (let index = 0; index < Math.max(a.pageCount, b.pageCount); index++) {
          await yieldTurn(context.signal);
          const signature = (doc: PdfDocument) => {
            if (index >= doc.pageCount) return undefined;
            const page = doc.getPage(index);
            const lines = page.extractPage().blocks.flatMap(block => block.lines);
            return JSON.stringify(mode === "text" ? lines.map(line => line.text) : {
              size: page.getSize(), rotation: page.getRotation(),
              lines: lines.map(line => ({ text: line.text, bbox: line.bbox,
                words: line.words.map(word => ({ text: word.text, bbox: word.bbox, fontSize: word.fontSize, fontName: word.fontName })) })),
            });
          };
          if (signature(a) !== signature(b)) {
            changed = true;
            await writeBytes(context.stdout, new TextEncoder().encode(`Page ${index + 1} differs (${mode})\n`), context.signal);
          }
        }
        return { exitCode: changed ? 1 : 0 };
      });
    },
  };
}
export function createDiffpdfCommands(options: DiffpdfCommandsOptions = {}): readonly CommandDefinition[] {
  const command = createDiffpdfCommand(options);
  return [command, { ...command, name: "pdfdiff" }];
}
export function diffpdfCommands(options: DiffpdfCommandsOptions = {}): VirtualShellPlugin {
  const commands = createDiffpdfCommands(options);
  return { name: "diffpdf", setup(host) {
    if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
