import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";
import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import type { ArchiveContext } from "./archive.js";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import { editDocumentComments, inspectDocumentComments, type CommentEditRequest, type CommentReadRequest } from "./comments.js";
import { PublicationError, type PublicationInput } from "./publication.js";

export async function executeCommentsCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined, request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  const options = invocation.options as CommentEditRequest["options"];
  if (invocation.operation === "comments.list" || invocation.operation === "comments.get") {
    const data = await inspectDocumentComments(bytes, { operation: invocation.operation, options } as CommentReadRequest, context);
    return new TextEncoder().encode(options.json ? JSON.stringify({ version: 1, operation: invocation.operation, ok: true, data, affected: 0, locations: data.items.map(note => note.location), warnings: [], errors: [] }) + "\n"
      : data.items.map(note => `${note.comment_id}: ${note.text.split("\n").map(line => escapeTerminalText(line)).join("\n")}`).join("\n") + "\n");
  }
  if ((options.inPlace || options.output !== undefined && options.output !== "-") && invocation.inputs[0] !== "-" && !input)
    throw new PublicationError("unsupported-publication", "File publication requires admitted input identity.");
  const output = options.output === undefined ? undefined : options.output === "-" ? "-" : resolvePath(request.cwd, options.output);
  const data = await editDocumentComments(bytes, { operation: invocation.operation, options: { ...options, ...(output === undefined ? {} : { output }) }, ...(input ? { input } : {}) } as CommentEditRequest,
    { ...context, encoding: { order: "input", compression: "store" }, filesystem: request.filesystem as FileSystem, stdout: request.stdout });
  if (output === "-" && !data.dryRun) return new Uint8Array();
  return new TextEncoder().encode(options.json ? JSON.stringify({ version: 1, operation: invocation.operation, ok: true, data, affected: data.changes.length, locations: data.changes.flatMap(change => change.after ? [change.after] : []), warnings: [], errors: [] }) + "\n"
    : `docx ${invocation.operation.split(".").join(" ")}: ${data.dryRun ? "dry-run; " : ""}${data.changes.length} ${data.changes.length === 1 ? "selection" : "selections"} changed\n`);
}
