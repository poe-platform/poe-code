import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import { archiveSettings, type ArchiveContext } from "./archive.js";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import { PublicationError, type PublicationInput } from "./publication.js";
import { sanitizeDocument, type SanitizationData } from "./sanitize.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";

export async function executeSanitizeCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined, request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  const options = invocation.options as DocxOperationArguments<"sanitize">;
  const output = options.output === undefined || options.output === "-" ? options.output : resolvePath(request.cwd, options.output);
  if ((options.inPlace || output !== undefined && output !== "-") && invocation.inputs[0] !== "-" && !input) throw new PublicationError("unsupported-publication", "Sanitization publication requires admitted input identity.");
  const settings = archiveSettings(context), budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(item => [item.name, item.value])));
  const envelope = (data: SanitizationData) => ({ version: 1, operation: "sanitize", ok: true, data, affected: data.actions.reduce((sum, action) => sum + action.affected, 0), locations: [], warnings: [], errors: [] });
  const human = (data: SanitizationData) => {
    const affected = data.actions.reduce((sum, action) => sum + action.affected, 0);
    return `docx sanitize: ${data.dryRun ? "dry-run; " : ""}${affected} ${affected === 1 ? "record" : "records"} affected\n` + data.actions.map(action => `  ${action.category}: ${action.action}; ${action.affected}\n`).join("") + `Retained categories: ${data.retained.join(", ") || "none selected for retention"}\n` + data.gaps.map(gap => `  ${gap}\n`).join("");
  };
  const data = await sanitizeDocument(bytes, { ...options, ...(input ? { input } : {}), ...(output === undefined ? {} : { output }) }, { ...settings, budget, encoding: { order: "input", compression: "store" }, filesystem: request.filesystem as FileSystem, stdout: request.stdout, admitSanitization(planned) {
    const size = output === "-" && !planned.dryRun ? 0 : options.json ? measurePackageResourceSerialization(envelope(planned), budget) + 1 : new TextEncoder().encode(human(planned)).length;
    budget.check("serializedOutput", size); budget.charge("retainedBytes", size * 8); budget.charge("work", size * 8);
  } });
  if (output === "-" && !data.dryRun) return new Uint8Array();
  return new TextEncoder().encode(options.json ? JSON.stringify(envelope(data)) + "\n" : human(data));
}
