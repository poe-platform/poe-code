import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";
import { inspectDocumentPackageResources, measurePackageResourceSerialization } from "./ancillary-resources.js";
import { archiveSettings, CancellationError, type ArchiveContext } from "./archive.js";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { PublicationError } from "./publication.js";
import { DocxUsageError } from "./argument-json.js";

export async function executePackageResourcesCommand(invocation: DocxInvocation, bytes: Uint8Array, request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  if (invocation.operation !== "custom-xml.list" && invocation.operation !== "glossary.list") throw new DocxUsageError("Expected a global package resource inventory.");
  const settings = archiveSettings(context), budget = settings.budget.lower(Object.fromEntries((invocation.options.limit as readonly { name: string; value: number }[] | undefined ?? []).map(limit => [limit.name, limit.value]))), data = await inspectDocumentPackageResources(bytes, invocation.operation, invocation.options as DocxOperationArguments<"custom-xml.list">, context);
  const warnings = data.items.some(item => item.details.kind === "custom-xml" ? item.details.storeItemId === null : item.details.buildingBlocks.length === 0 || item.details.buildingBlocks.some(block => block.name === null || block.guid === null || block.category === null || block.gallery === null)) ? [{ code: "unrecognized-resource-metadata", message: "Resource metadata is missing, ambiguous or unrecognized; resources remain preserved." }] : [];
  const result = { version: 1, operation: invocation.operation, ok: true, data, warnings, errors: [], affected: 0, locations: data.items.map(item => item.location) };
  const human = `${invocation.operation === "custom-xml.list" ? "Custom XML" : "Glossary"} resources: ${data.items.length}\n` + data.items.map(item => `${escapeTerminalText(item.name)}: preserve; ${item.details.parts.length} parts; ${item.references.length} references`).join("\n") + (data.items.length ? "\n" : "");
  const length = invocation.options.json ? measurePackageResourceSerialization(result, budget) + 1 : new TextEncoder().encode(human).length; budget.check("serializedOutput", length); budget.charge("retainedBytes", length * 3);
  const text = invocation.options.json ? JSON.stringify(result) + "\n" : human, output = new TextEncoder().encode(text);
  const diagnosticLength = warnings.reduce((length, warning) => length + "docx: ".length + warning.code.length + ": ".length + warning.message.length + 1, 0);
  budget.check("diagnosticBytes", diagnosticLength); budget.charge("retainedBytes", diagnosticLength * 3);
  if (warnings.length) {
    const diagnostic = new TextEncoder().encode(warnings.map(warning => `docx: ${warning.code}: ${warning.message}\n`).join(""));
    try { await request.stderr.write(diagnostic); }
    catch (cause) { if (context.signal.aborted) throw new CancellationError("Resource inventory diagnostics cancelled.", { cause }); throw new PublicationError("sink-failure", "Resource inventory diagnostics could not be written.", [], false, { cause }); }
  }
  budget.check("work", 0); budget.check("serializedOutput", output.length); return output;
}
