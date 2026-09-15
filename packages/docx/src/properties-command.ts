import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";
import { inspectDocumentProperties, editDocumentProperties, type PropertyInspectionData, type PropertyMutationData, type PropertyWarning } from "./document-properties.js";
import { normalizeDocxPropertyOptions } from "./command-properties.js";
import { propertyDeclaration } from "./property-values.js";
import { readDocumentArchive } from "./admission.js";
import { archiveSettings, CancellationError, type ArchiveContext } from "./archive.js";
import { SelectionError } from "./location-token.js";
import { PublicationError, type PublicationInput } from "./publication.js";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import { DocxUsageError } from "./argument-json.js";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";

function utf8Length(text: string): number {
  let length = 0; for (const character of text) { const code = character.codePointAt(0)!; length += code <= 127 ? 1 : code <= 2047 ? 2 : code <= 65535 ? 3 : 4; } return length;
}
function escapedUtf8Length(text: string): number {
  let length = 0; for (const character of text) length += utf8Length(escapeTerminalText(character)); return length;
}

export async function executePropertiesCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined, request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  if (!["properties.list", "properties.get", "properties.set", "properties.remove"].includes(invocation.operation)) throw new DocxUsageError("Expected a document property operation.");
  const settings = archiveSettings(context), options = { ...invocation.options }, edit = invocation.operation === "properties.set" || invocation.operation === "properties.remove";
  const budget = settings.budget.lower(Object.fromEntries((options.limit as readonly { name: string; value: number }[] | undefined ?? []).map(v => [v.name, v.value])));
  if (edit && (options.inPlace || options.output !== undefined && options.output !== "-") && invocation.inputs[0] !== "-" && !input) throw new PublicationError("unsupported-publication", "File publication requires admitted input identity.");
  if (invocation.operation === "properties.set") {
    let type = options.type, qualified = options.name as string;
    try { const snapshot = await inspectDocumentProperties(bytes, { name: qualified }, { ...context, budget }), item = snapshot.items[0]!; qualified = item.name ?? qualified; type ??= item.properties[0]?.type; }
    catch (error) {
      if (!(error instanceof SelectionError) || error.code !== "missing-selection") throw error;
      const archive = await readDocumentArchive(bytes, { ...context, budget });
      if (!qualified.includes(":")) { const group = propertyDeclaration("core", qualified, archive.dialect) ? "core" : propertyDeclaration("extended", qualified, archive.dialect) ? "extended" : "custom"; qualified = `${group}:${qualified}`; }
    }
    const normalized = normalizeDocxPropertyOptions({ name: qualified, value: options.value, ...(type === undefined ? {} : { type }) }, typeof options.value === "string");
    options.value = normalized.value;
  }
  const output = options.output === undefined ? undefined : options.output === "-" ? "-" : resolvePath(request.cwd, options.output as string);
  let data: PropertyInspectionData | PropertyMutationData;
  if (edit) data = await editDocumentProperties(bytes, { ...options, operation: invocation.operation, ...(input ? { input } : {}), ...(output === undefined ? {} : { output }) } as Parameters<typeof editDocumentProperties>[1], { ...context, budget, encoding: { order: "input", compression: "store" }, filesystem: request.filesystem as FileSystem, stdout: request.stdout });
  else data = await inspectDocumentProperties(bytes, options as Parameters<typeof inspectDocumentProperties>[1], { ...context, budget });
  if (edit && output === "-" && "dryRun" in data && !data.dryRun) return new Uint8Array();
  const warnings: readonly PropertyWarning[] = "warnings" in data ? data.warnings : [], affected = "changes" in data ? data.changes.length : 0;
  const resultData = "items" in data ? invocation.operation === "properties.get" ? { item: data.items[0]! } : { items: data.items } : data;
  const locations = "items" in data ? data.items.map(item => item.location) : data.changes.flatMap(change => change.after ? [change.after] : change.before ? [change.before] : []);
  const envelope = { version: 1, operation: invocation.operation, ok: true, data: resultData, warnings, errors: [], affected, locations };
  if (options.json) {
    const measured = measurePackageResourceSerialization(envelope, budget);
    budget.check("serializedOutput", measured + 1); budget.charge("retainedBytes", (measured + 1) * 6);
  } else {
    const retained = "items" in data ? data.items.reduce((size, item) => size + (item.name?.length ?? 16) + (item.properties.length ? String(item.properties[0]!.value).length : 32) + 4, 16) : 128;
    budget.charge("retainedBytes", retained * 12); budget.charge("work", retained * 12);
  }
  let text: string;
  if (options.json) text = JSON.stringify(envelope) + "\n";
  else if ("items" in data && data.items.length) {
    const fields = data.items.map(item => [item.name ?? "Unnamed property", item.properties.length ? String(item.properties[0]!.value) : "preserved unsupported value"] as const);
    const minimum = fields.reduce((size, [name, value]) => size + utf8Length(name) + utf8Length(value) + 3, 0);
    budget.check("serializedOutput", minimum);
    const exact = fields.reduce((size, [name, value]) => size + escapedUtf8Length(name) + escapedUtf8Length(value) + 3, 0);
    budget.check("serializedOutput", exact);
    text = fields.map(([name, value]) => `${escapeTerminalText(name)}: ${escapeTerminalText(value)}`).join("\n") + "\n";
  } else {
    text = "items" in data ? "Properties: 0\n" : `docx ${invocation.operation.split(".").join(" ")}: ${data.dryRun ? "dry-run; " : ""}${affected} properties changed\n`;
    budget.check("serializedOutput", utf8Length(text));
  }
  const length = utf8Length(text);
  budget.check("serializedOutput", length); budget.charge("retainedBytes", length * 3);
  budget.charge("work", warnings.reduce((size, warning) => size + 9 + warning.code.length + warning.message.length, 0));
  const diagnosticLength = warnings.reduce((size, warning) => size + 9 + utf8Length(warning.code) + utf8Length(warning.message), 0);
  budget.check("diagnosticBytes", diagnosticLength); budget.charge("retainedBytes", diagnosticLength * 3);
  const diagnosticText = warnings.map(warning => `docx: ${warning.code}: ${warning.message}\n`).join("");
  if (diagnosticLength) { try { await request.stderr.write(new TextEncoder().encode(diagnosticText)); } catch (cause) { if (settings.signal.aborted) throw new CancellationError("Property diagnostics cancelled.", { cause }); throw new PublicationError("sink-failure", "Property diagnostics could not be written.", [], false, { cause }); } }
  budget.check("work", 0); return new TextEncoder().encode(text);
}
