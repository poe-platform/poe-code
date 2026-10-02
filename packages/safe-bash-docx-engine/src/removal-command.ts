import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import type { ArchiveContext } from "./archive.js";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import { removeDocumentContent, type ContentRemovalRequest } from "./removal.js";
import { PublicationError, type PublicationInput } from "./publication.js";

export async function executeContentRemovalCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined, request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  const options = invocation.options as ContentRemovalRequest["options"];
  if ((options.inPlace || options.output !== undefined && options.output !== "-") && invocation.inputs[0] !== "-" && !input)
    throw new PublicationError("unsupported-publication", "File publication requires admitted input identity.");
  const output = options.output === undefined ? undefined : options.output === "-" ? "-" : resolvePath(request.cwd, options.output);
  const data = await removeDocumentContent(bytes, { operation: invocation.operation, options: { ...options, ...(output === undefined ? {} : { output }) }, ...(input ? { input } : {}) } as ContentRemovalRequest,
    { ...context, encoding: { order: "input", compression: "store" }, filesystem: request.filesystem as FileSystem, stdout: request.stdout });
  if (output === "-" && !data.dryRun) return new Uint8Array();
  return new TextEncoder().encode(options.json ? JSON.stringify({ version: 1, operation: invocation.operation, ok: true, data, affected: data.changes.length, locations: data.changes.flatMap(c => c.after ? [c.after] : []), warnings: [], errors: [] }) + "\n"
    : `docx ${invocation.operation.split(".").join(" ")}: ${data.dryRun ? "dry-run; " : ""}${data.changes.length} ${data.changes.length === 1 ? "selection" : "selections"} changed\n`);
}
