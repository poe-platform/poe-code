import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";
import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import type { ArchiveContext } from "./archive.js";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import { PublicationError, type PublicationInput } from "./publication.js";
import { editDocumentSections, inspectDocumentSections, type SectionEditRequest } from "./sections.js";

export async function executeSectionsCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined, request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  const options = invocation.options as SectionEditRequest["options"];
  if (invocation.operation === "sections.list") {
    const data = await inspectDocumentSections(bytes, options, context);
    return new TextEncoder().encode(options.json ? JSON.stringify({ version: 1, operation: invocation.operation, ok: true, data, affected: 0, locations: data.items.map(s => s.location), warnings: [], errors: [] }) + "\n" : data.items.map(s => escapeTerminalText(`Section ${s.position}: ${s.direct.orientation}, ${s.direct.startType}, ${s.direct.columns} column(s)`)).join("\n") + "\n");
  }
  if ((options.inPlace || options.output !== undefined && options.output !== "-") && invocation.inputs[0] !== "-" && !input) throw new PublicationError("unsupported-publication", "File publication requires admitted input identity.");
  const output = options.output === undefined ? undefined : options.output === "-" ? "-" : resolvePath(request.cwd, options.output);
  const data = await editDocumentSections(bytes, { operation: invocation.operation, options: { ...options, ...(output === undefined ? {} : { output }) }, ...(input ? { input } : {}) } as SectionEditRequest,
    { ...context, encoding: { order: "input", compression: "store" }, filesystem: request.filesystem as FileSystem, stdout: request.stdout });
  if (output === "-" && !data.dryRun) return new Uint8Array();
  return new TextEncoder().encode(options.json ? JSON.stringify({ version: 1, operation: invocation.operation, ok: true, data, affected: data.changes.length, locations: data.changes.map(c => c.after), warnings: [], errors: [] }) + "\n"
    : `docx ${invocation.operation.split(".").join(" ")}: ${data.dryRun ? "dry-run; " : ""}${data.changes.length} section(s) changed\n`);
}
