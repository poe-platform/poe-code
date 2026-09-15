import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";
import { archiveSettings, type ArchiveContext } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { PublicationError, type PublicationInput } from "./publication.js";
import { inspectDocumentShapes, editDocumentShapes, type ShapeEditData } from "./shape-edit.js";

/** Serializes native shape inventory and bounded text assignment using admitted capabilities. */
export async function executeShapesCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined, request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  if (invocation.operation !== "shapes.list" && invocation.operation !== "shapes.set") throw new DocxUsageError("Expected a shape inventory or text assignment operation.");
  const settings = archiveSettings(context), shapeOptions = invocation.options as DocxOperationArguments<"shapes.list"> | DocxOperationArguments<"shapes.set">;
  const budget = settings.budget.lower(Object.fromEntries((shapeOptions.limit ?? []).map(limit => [limit.name, limit.value])));
  if (invocation.operation === "shapes.list") {
    const inspected = await inspectDocumentShapes(bytes, invocation.options as DocxOperationArguments<"shapes.list">, { ...settings, budget });
    const { warnings, ...data } = inspected;
    const envelope = { version: 1, operation: "shapes.list", ok: true, data, affected: 0, locations: data.items.map(item => item.location), warnings, errors: [] };
    const retainedSize = measurePackageResourceSerialization(envelope, budget);
    budget.charge("retainedBytes", retainedSize * 12); budget.charge("work", retainedSize * 12);
    const human = `Shapes: ${data.items.length}\n` + data.items.map(item => `${escapeTerminalText(item.name ?? "Unnamed shape")}: ${item.details.representation}; ${item.details.kind}; ${item.support}\n`).join("");
    const size = invocation.options.json ? measurePackageResourceSerialization(envelope, budget) + 1 : new TextEncoder().encode(human).length;
    const diagnostic = warnings.map(warning => `docx: ${escapeTerminalText(warning.code)}: ${escapeTerminalText(warning.message)}\n`).join("");
    budget.check("serializedOutput", size); budget.check("diagnosticBytes", new TextEncoder().encode(diagnostic).length); budget.charge("retainedBytes", size * 8 + diagnostic.length * 8); budget.charge("work", size * 8 + diagnostic.length * 8);
    if (diagnostic) await request.stderr.write(new TextEncoder().encode(diagnostic)); settings.signal.throwIfAborted();
    return new TextEncoder().encode(invocation.options.json ? JSON.stringify(envelope) + "\n" : human);
  }
  const options = invocation.options as DocxOperationArguments<"shapes.set">;
  const output = options.output === undefined || options.output === "-" ? options.output : resolvePath(request.cwd, options.output);
  if ((options.inPlace || output !== undefined && output !== "-") && invocation.inputs[0] !== "-" && !input) throw new PublicationError("unsupported-publication", "Shape publication requires admitted input identity.");
  const envelope = (data: ShapeEditData) => ({ version: 1, operation: "shapes.set", ok: true, data, affected: data.changes.length, locations: data.changes.map(change => change.after), warnings: [], errors: [] });
  const human = (data: ShapeEditData) => `docx shapes set: ${data.dryRun ? "dry-run; " : ""}${data.changes.length} ${data.changes.length === 1 ? "shape" : "shapes"} changed\n`;
  const data = await editDocumentShapes(bytes, { operation: "shapes.set", options: { ...options, ...(output === undefined ? {} : { output }) }, ...(input ? { input } : {}) }, {
    ...settings, budget, encoding: { order: "input", compression: "store" }, filesystem: request.filesystem as FileSystem, stdout: request.stdout,
    ...(request.registerCleanup ? { registerCleanup: request.registerCleanup } : {}),
    admitPublication(planned: ShapeEditData): undefined {
      const size = output === "-" && !planned.dryRun ? 0 : options.json ? measurePackageResourceSerialization(envelope(planned), budget) + 1 : new TextEncoder().encode(human(planned)).length;
      const diagnostics = new TextEncoder().encode("docx: unsupported-publication: Document operation failed: unsupported-publication\n").length;
      budget.check("serializedOutput", size); budget.check("diagnosticBytes", diagnostics); budget.charge("retainedBytes", size * 8 + diagnostics * 8); budget.charge("work", size * 8 + diagnostics * 8); return undefined;
    }
  });
  if (output === "-" && !data.dryRun) return new Uint8Array();
  return new TextEncoder().encode(options.json ? JSON.stringify(envelope(data)) + "\n" : human(data));
}
