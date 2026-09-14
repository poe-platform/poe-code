import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import type { ArchiveContext } from "./archive.js";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import { PublicationError, type PublicationInput } from "./publication.js";
import { replaceDocumentText, type TextReplaceOptions } from "./text-replace.js";

export async function executeTextReplaceCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined,
  request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  const options = invocation.options as TextReplaceOptions;
  if ((options.inPlace || options.output !== undefined && options.output !== "-") && invocation.inputs[0] !== "-" && !input)
    throw new PublicationError("unsupported-publication", "File publication requires admitted input identity.");
  const output = options.output === undefined ? undefined : options.output === "-" ? "-" : resolvePath(request.cwd, options.output);
  const data = await replaceDocumentText(bytes, { ...options, ...(input ? { input } : {}), ...(output === undefined ? {} : { output }) },
    { ...context, encoding: { order: "input", compression: "store" }, filesystem: request.filesystem as FileSystem, stdout: request.stdout });
  if (output === "-" && !data.dryRun) return new Uint8Array();
  return new TextEncoder().encode(options.json ? JSON.stringify({ version: 1, operation: "text.replace", ok: true, data,
    warnings: [], errors: [], affected: data.changes.length, locations: data.changes.map(change => change.after) }) + "\n"
    : `docx text replace: ${data.dryRun ? "dry-run; " : ""}${data.changes.length} ${data.changes.length === 1 ? "match" : "matches"} replaced\n`);
}
