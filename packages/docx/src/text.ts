import { archiveSettings, type ArchiveContext } from "./archive.js";
import { openDocumentLocations } from "./locations.js";
import { validateDocxInvocation } from "./command.js";
import type { DocxOperationArguments } from "./operation-types.js";
import type { TextData } from "./text-traversal.js";

export type TextOptions = DocxOperationArguments<"text.get">;

/** Extract from owned bytes with explicit limits; no host filesystem or field execution. */
export async function extractDocumentText(input: Uint8Array, context: ArchiveContext, options: TextOptions = {}): Promise<TextData> {
  const settings = archiveSettings(context);
  const invocation = validateDocxInvocation({ operation: "text.get", inputs: ["document"], options }, settings.budget);
  const limits = invocation.options.limit as TextOptions["limit"];
  const budget = settings.budget.lower(Object.fromEntries((limits ?? []).map(item => [item.name, item.value])));
  const document = await openDocumentLocations(input, { ...settings, budget });
  return document.text(invocation.options as TextOptions);
}
