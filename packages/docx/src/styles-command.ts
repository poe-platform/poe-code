import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";
import type { ArchiveContext } from "./archive.js";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import { PublicationError, type PublicationInput } from "./publication.js";
import { inspectDocumentStyles, editDocumentStyles } from "./styles.js";

export async function executeStylesCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined,
  request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  const options = invocation.options;
  const edit = ["styles.add", "styles.set", "styles.defaults.set"].includes(invocation.operation);
  if (edit && (options.inPlace || options.output !== undefined && options.output !== "-") && invocation.inputs[0] !== "-" && !input)
    throw new PublicationError("unsupported-publication", "File publication requires admitted input identity.");
  const output = options.output === undefined ? undefined : options.output === "-" ? "-" : resolvePath(request.cwd, options.output as string);
  const data = edit ? await editDocumentStyles(bytes, { ...options, operation: invocation.operation,
    ...(input ? { input } : {}), ...(output === undefined ? {} : { output }) } as Parameters<typeof editDocumentStyles>[1],
    { ...context, encoding: { order: "input", compression: "store" }, filesystem: request.filesystem as FileSystem, stdout: request.stdout })
    : await inspectDocumentStyles(bytes, options as Parameters<typeof inspectDocumentStyles>[1], context);
  if (edit && output === "-" && "dryRun" in data && !data.dryRun) return new Uint8Array();
  const affected = "changes" in data ? data.changes.length : 0;
  const human = invocation.operation === "styles.defaults.get" && "defaults" in data ? escapeTerminalText(JSON.stringify(data.defaults, null, 2)) + "\n"
    : invocation.operation === "styles.get" && "styles" in data ? data.styles.map(style => [
      `${escapeTerminalText(style.id)}: ${escapeTerminalText(style.name)} (${escapeTerminalText(style.type)})`,
      `Base: ${escapeTerminalText(style.base ?? "none")}; next: ${escapeTerminalText(style.next ?? "none")}; linked: ${escapeTerminalText(style.linkedStyle ?? "none")}`,
      `Direct: ${escapeTerminalText(JSON.stringify(style.direct))}`,
      `Inherited result: ${escapeTerminalText(JSON.stringify(style.effective))}`
    ].join("\n")).join("\n") + "\n"
    : "styles" in data ? data.styles.map(style => `${escapeTerminalText(style.id)}: ${escapeTerminalText(style.name)}`).join("\n") + "\n"
    : `docx ${invocation.operation.split(".").join(" ")}: ${"dryRun" in data && data.dryRun ? "dry-run; " : ""}${affected} styles changed\n`;
  return new TextEncoder().encode(options.json ? JSON.stringify({ version: 1, operation: invocation.operation, ok: true, data,
    warnings: [], errors: [], affected, locations: [] }) + "\n" : human);
}
