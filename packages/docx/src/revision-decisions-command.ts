import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import type { ArchiveContext } from "./archive.js";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import { PublicationError, type PublicationInput } from "./publication.js";
import { editDocumentRevisionDecisions, type RevisionDecisionRequest } from "./revision-decisions.js";

export async function executeRevisionDecisionCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined, request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  const options = invocation.options as RevisionDecisionRequest["options"];
  const output = options.output === undefined || options.output === "-" ? options.output : resolvePath(request.cwd, options.output);
  if ((options.inPlace || output !== undefined && output !== "-") && invocation.inputs[0] !== "-" && !input) throw new PublicationError("unsupported-publication", "Revision decision publication requires admitted input identity.");
  const data = await editDocumentRevisionDecisions(bytes, { operation: invocation.operation as RevisionDecisionRequest["operation"], options: { ...options, ...(output === undefined ? {} : { output }) }, ...(input ? { input } : {}) },
    { ...context, encoding: { order: "input", compression: "store" }, filesystem: request.filesystem as FileSystem, stdout: request.stdout });
  if (output === "-" && !data.dryRun) return new Uint8Array();
  return new TextEncoder().encode((options.json ? JSON.stringify({ version: 1, operation: invocation.operation, ok: true, data, affected: data.changes.length, locations: data.changes.flatMap(change => change.after ? [change.after] : []), warnings: [], errors: [] })
    : `docx ${invocation.operation.split(".").join(" ")}: ${data.dryRun ? "dry-run; " : ""}${data.changes.length} ${data.changes.length === 1 ? "revision" : "revisions"} decided`) + "\n");
}
