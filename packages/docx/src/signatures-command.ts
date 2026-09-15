import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";
import { archiveSettings, type ArchiveContext } from "./archive.js";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { PublicationError, type PublicationInput } from "./publication.js";
import { inspectDocumentSignatures, stripDocumentSignatures, type SignatureMutationData } from "./signatures.js";

/** Inventories inert signature declarations or explicitly removes their complete graph. */
export async function executeSignaturesCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined,
  request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  const settings = archiveSettings(context), encoder = new TextEncoder();
  const budget = settings.budget.lower(Object.fromEntries(((invocation.options as DocxOperationArguments<"signatures.list">).limit ?? []).map(item => [item.name, item.value])));
  if (invocation.operation === "signatures.list") {
    const data = await inspectDocumentSignatures(bytes, invocation.options as DocxOperationArguments<"signatures.list">, { ...settings, budget });
    const envelope = { version: 1, operation: invocation.operation, ok: true, data, warnings: [], errors: [], affected: 0, locations: data.items.map(item => item.location) };
    measurePackageResourceSerialization(envelope, budget);
    const text = invocation.options.json ? JSON.stringify(envelope) + "\n" : `Signature parts: ${data.items.length}; relationships: ${data.relationships.length}\nCryptographic validity: unknown (not verified)\n` + data.items.map(item => `${escapeTerminalText(item.name)}: ${item.details.role}\n`).join("") + data.relationships.map(edge => `  Relationship: ${escapeTerminalText(edge.owner)} ${escapeTerminalText(edge.id)} ${escapeTerminalText(edge.type)} -> ${escapeTerminalText(edge.target ?? "redacted external target")} (${edge.external ? "external" : "internal"})\n`).join("");
    const output = encoder.encode(text);
    budget.check("serializedOutput", output.length); budget.charge("retainedBytes", output.length * 8); budget.charge("work", output.length * 8);
    settings.signal.throwIfAborted();
    return output;
  }
  const options = invocation.options as DocxOperationArguments<"signatures.remove">;
  const output = options.output === undefined || options.output === "-" ? options.output : resolvePath(request.cwd, options.output);
  if ((options.inPlace || output !== undefined && output !== "-") && invocation.inputs[0] !== "-" && !input)
    throw new PublicationError("unsupported-publication", "Signature publication requires admitted input identity.");
  const envelope = (data: SignatureMutationData) => ({ version: 1, operation: "signatures.remove", ok: true, data, warnings: [], errors: [], affected: data.removedParts.length, locations: [] });
  const human = (data: SignatureMutationData) => `docx signatures remove: ${data.dryRun ? "dry-run; " : ""}${data.removedParts.length} parts, ${data.removedRelationships.length} relationships, ${data.removedContentTypes.length} content-type entries removed\n` + data.removedParts.map(name => `  Part: ${escapeTerminalText(name)}\n`).join("") + data.removedRelationships.map(edge => `  Relationship: ${escapeTerminalText(edge.owner)} ${escapeTerminalText(edge.id)} ${escapeTerminalText(edge.type)} -> ${escapeTerminalText(edge.target ?? "redacted external target")} (${edge.external ? "external" : "internal"})\n`).join("") + data.removedContentTypes.map(entry => `  Content type: ${entry.kind} ${escapeTerminalText(entry.name)} ${escapeTerminalText(entry.contentType)}\n`).join("");
  const data = await stripDocumentSignatures(bytes, { ...options, ...(input ? { input } : {}), ...(output === undefined ? {} : { output }) }, {
    ...settings, budget, encoding: { order: "input", compression: "store" }, filesystem: request.filesystem as FileSystem, stdout: request.stdout,
    admitPublication(planned): undefined {
      const size = output === "-" && !planned.dryRun ? 0 : options.json ? measurePackageResourceSerialization(envelope(planned), budget) + 1 : encoder.encode(human(planned)).length;
      budget.check("serializedOutput", size); budget.charge("retainedBytes", size * 8); budget.charge("work", size * 8);
      return undefined;
    }
  });
  if (output === "-" && !data.dryRun) return new Uint8Array();
  return encoder.encode(options.json ? JSON.stringify(envelope(data)) + "\n" : human(data));
}
