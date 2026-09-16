import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";
import { archiveSettings, type ArchiveContext } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { inspectDocumentDiagrams } from "./diagrams.js";
import type { DocumentBudget } from "./budget.js";
import type { Location } from "./location-token.js";

/** Bounds the existing located failure envelope before any JSON allocation or publication. */
export function serializeDiagramMutationFailure(operation: string, error: { readonly location: Location; readonly locations: readonly Location[] }, code: string, message: string, budget: DocumentBudget): Uint8Array {
  const diagnostic = { code, message, location: error.location.token };
  const diagnosticSize = measurePackageResourceSerialization(diagnostic, budget);
  budget.check("diagnosticBytes", diagnosticSize);
  const envelope = { version: 1, operation, ok: false, data: null, affected: 0, locations: error.locations, warnings: [], errors: [diagnostic] };
  const size = measurePackageResourceSerialization(envelope, budget) + 1;
  budget.check("serializedOutput", size);
  budget.charge("retainedBytes", size * 12); budget.charge("work", size * 12);
  return new TextEncoder().encode(JSON.stringify(envelope) + "\n");
}

/** Serializes inert physical diagram and opaque graphics snapshots. */
export async function executeDiagramsCommand(invocation: DocxInvocation, bytes: Uint8Array, request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  if (invocation.operation !== "diagrams.list") throw new DocxUsageError("Expected physical diagram inventory.");
  const options = invocation.options as DocxOperationArguments<"diagrams.list">, settings = archiveSettings(context);
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(limit => [limit.name, limit.value])));
  const { warnings, ...data } = await inspectDocumentDiagrams(bytes, options, { ...settings, budget });
  const envelope = { version: 1, operation: "diagrams.list", ok: true, data, affected: 0, locations: data.items.map(item => item.location), warnings, errors: [] };
  const retainedSize = measurePackageResourceSerialization(envelope, budget);
  budget.charge("retainedBytes", retainedSize * 12); budget.charge("work", retainedSize * 12);
  const human = `Diagram records: ${data.items.length}\n` + data.items.map(item => `${escapeTerminalText(item.name)}: ${escapeTerminalText(item.details.roles.map(role => role.role).join(", ") || "opaque graphics")}; preserve\n`).join("");
  const diagnostic = warnings.map(warning => `docx: ${escapeTerminalText(warning.code)}: ${escapeTerminalText(warning.message)}\n`).join("");
  const encoder = new TextEncoder(), diagnosticBytes = encoder.encode(diagnostic), size = options.json ? retainedSize + 1 : encoder.encode(human).length;
  budget.check("serializedOutput", size); budget.check("diagnosticBytes", diagnosticBytes.length);
  budget.charge("retainedBytes", size * 8 + diagnosticBytes.length * 8); budget.charge("work", size * 8 + diagnosticBytes.length * 8);
  if (diagnosticBytes.length) await request.stderr.write(diagnosticBytes);
  settings.signal.throwIfAborted();
  return encoder.encode(options.json ? JSON.stringify(envelope) + "\n" : human);
}
