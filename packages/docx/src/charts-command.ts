import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";
import { archiveSettings, type ArchiveContext } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { inspectDocumentCharts } from "./charts.js";

/** Serializes physical chart-part snapshots without executing formulas or acquiring resources. */
export async function executeChartsCommand(invocation: DocxInvocation, bytes: Uint8Array, request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  if (invocation.operation !== "charts.list") throw new DocxUsageError("Expected physical chart inventory.");
  const options = invocation.options as DocxOperationArguments<"charts.list">, settings = archiveSettings(context);
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(limit => [limit.name, limit.value])));
  const inspected = await inspectDocumentCharts(bytes, options, { ...settings, budget });
  const { warnings, ...data } = inspected;
  const envelope = { version: 1, operation: "charts.list", ok: true, data, affected: 0, locations: data.items.map(item => item.location), warnings, errors: [] };
  const retainedSize = measurePackageResourceSerialization(envelope, budget);
  budget.charge("retainedBytes", retainedSize * 12); budget.charge("work", retainedSize * 12);
  const human = `Chart parts: ${data.items.length}\n` + data.items.map(item => `${escapeTerminalText(item.name ?? item.location.value.part)}: ${escapeTerminalText(item.details.chartTypes.join(", ") || "opaque or no plot groups")}; ${item.support}\n`).join("");
  const diagnostic = warnings.map(warning => `docx: ${escapeTerminalText(warning.code)}: ${escapeTerminalText(warning.message)}\n`).join("");
  const size = options.json ? retainedSize + 1 : new TextEncoder().encode(human).length;
  budget.check("serializedOutput", size); budget.check("diagnosticBytes", new TextEncoder().encode(diagnostic).length);
  budget.charge("retainedBytes", size * 8 + diagnostic.length * 8); budget.charge("work", size * 8 + diagnostic.length * 8);
  if (diagnostic) await request.stderr.write(new TextEncoder().encode(diagnostic)); settings.signal.throwIfAborted();
  return new TextEncoder().encode(options.json ? JSON.stringify(envelope) + "\n" : human);
}
