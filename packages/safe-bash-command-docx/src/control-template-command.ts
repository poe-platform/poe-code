import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import type { ArchiveContext } from "safe-bash-docx-engine/archive";
import type { DocxInvocation } from "./command.js";
import { applyDocumentTemplate } from "safe-bash-docx-engine/template";
import { editDocumentControlBindings } from "safe-bash-docx-engine/control-bindings";
import { editDocumentControlRepeats } from "safe-bash-docx-engine/control-repeat";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import type { DocxOperationArguments } from "safe-bash-docx-engine/operation-types";
import { PublicationError, type PublicationInput } from "safe-bash-docx-engine/publication";

export async function executeControlTemplateCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined, request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  const options = invocation.options as DocxOperationArguments<"controls.repeat">;
  const output = options.output === undefined || options.output === "-" ? options.output : resolvePath(request.cwd, options.output);
  if ((options.inPlace || output !== undefined && output !== "-") && invocation.inputs[0] !== "-" && !input) throw new PublicationError("unsupported-publication", "Control template publication requires admitted input identity.");
  const args = { ...invocation.options, ...(output === undefined ? {} : { output }), ...(input ? { input } : {}) };
  const publication = { ...context, encoding: { order: "input", compression: "store" } as const, filesystem: request.filesystem as FileSystem, stdout: request.stdout };
  const data = invocation.operation === "template.apply" ? await applyDocumentTemplate(bytes, args as DocxOperationArguments<"template.apply">, publication) : invocation.operation === "controls.repeat" ? await editDocumentControlRepeats(bytes, args as DocxOperationArguments<"controls.repeat">, publication) : await editDocumentControlBindings(bytes, args as DocxOperationArguments<"controls.bind">, publication);
  if (output === "-" && !data.dryRun) return new Uint8Array();
  return new TextEncoder().encode((options.json ? JSON.stringify({ version: 1, operation: invocation.operation, ok: true, data, affected: data.changes.length, locations: data.changes.map(change => change.after), warnings: [], errors: [] }) : `docx ${invocation.operation.split(".").join(" ")}: ${data.dryRun ? "dry-run; " : ""}${data.changes.length} control owners changed`) + "\n");
}
