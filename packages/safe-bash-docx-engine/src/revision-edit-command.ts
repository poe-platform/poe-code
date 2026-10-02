import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import type { ArchiveContext } from "./archive.js";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import { PublicationError, type PublicationInput } from "./publication.js";
import { editDocumentRevisions, type RevisionEditOptions } from "./revision-edit.js";

export async function executeRevisionEditCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined, request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  const options = invocation.options as RevisionEditOptions;
  const destination = options.output === undefined || options.output === "-" ? options.output : resolvePath(request.cwd, options.output);
  if ((options.inPlace || destination !== undefined && destination !== "-") && invocation.inputs[0] !== "-" && !input)
    throw new PublicationError("unsupported-publication", "Tracked file publication requires admitted input identity.");
  const data = await editDocumentRevisions(bytes, { ...options, ...(input ? { input } : {}), ...(destination === undefined ? {} : { output: destination }) },
    { ...context, encoding: { order: "input", compression: "store" }, filesystem: request.filesystem as FileSystem, stdout: request.stdout });
  if (destination === "-" && !data.dryRun) return new Uint8Array();
  const message = options.json ? JSON.stringify({ version: 1, operation: "revisions.add", ok: true, data, affected: data.changes.length, locations: data.changes.map(change => change.after), warnings: [], errors: [] })
    : `docx revisions add: ${data.dryRun ? "dry-run; " : ""}${data.changes.length} tracked ${options.kind === "insert" ? "insertions" : "deletions"}`;
  return new TextEncoder().encode(message + "\n");
}
