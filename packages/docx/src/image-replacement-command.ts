import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import { archiveSettings, type ArchiveContext } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import { replaceDocumentImage, type ImageReplacementData } from "./image-replacement.js";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";
import { DocumentIo } from "./io.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { UnsupportedProfileError } from "./package-xml.js";
import { PublicationError, type PublicationInput } from "./publication.js";

export async function executeImageReplacementCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined, request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  if (invocation.operation !== "images.replace") throw new DocxUsageError("Expected image replacement.");
  const settings = archiveSettings(context), options = invocation.options as DocxOperationArguments<"images.replace">;
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(limit => [limit.name, limit.value])));
  const output = options.output === undefined || options.output === "-" ? options.output : resolvePath(request.cwd, options.output);
  const file = options.file.kind === "vfs" && options.file.capability === "command" ? { ...options.file, path: resolvePath(request.cwd, options.file.path) } : options.file;
  if ((options.inPlace || output !== undefined && output !== "-") && invocation.inputs[0] !== "-" && !input) throw new PublicationError("unsupported-publication", "Image publication requires admitted input identity.");
  const envelope = (data: ImageReplacementData) => ({ version: 1, operation: "images.replace", ok: true, data, affected: data.changes.length, locations: data.changes.map(change => change.after), warnings: [], errors: [] });
  const human = (data: ImageReplacementData) => `docx images replace: ${data.dryRun ? "dry-run; " : ""}${data.changes.length} ${data.changes.length === 1 ? "occurrence" : "occurrences"} changed\n`;
  const data = await replaceDocumentImage(bytes, { operation: "images.replace", options: { ...options, file, ...(output === undefined ? {} : { output }) }, ...(input ? { input } : {}) }, {
    ...settings, budget, encoding: { order: "input", compression: "store" }, filesystem: request.filesystem as FileSystem, stdout: request.stdout,
    ...(request.registerCleanup ? { registerCleanup: request.registerCleanup } : {}),
    admitPublication(planned): undefined {
      const size = output === "-" && !planned.dryRun ? 0 : options.json ? measurePackageResourceSerialization(envelope(planned), budget) + 1 : new TextEncoder().encode(human(planned)).length;
      const diagnostics = new TextEncoder().encode("docx: unsupported-publication: Document operation failed: unsupported-publication\n").length;
      budget.check("serializedOutput", size); budget.check("diagnosticBytes", diagnostics); budget.charge("retainedBytes", size * 8 + diagnostics * 8); budget.charge("work", size * 8 + diagnostics * 8);
      return undefined;
    },
    binaryResolver: { capability: "command", async *open(path, { signal, maxBytes }) {
      const readStream = request.filesystem.readStream;
      if (!readStream) throw new UnsupportedProfileError("Image paths require an explicit streaming read capability.");
      const source = { open: (inner: AbortSignal) => readStream.call(request.filesystem, resolvePath(request.cwd, path), { signal: inner }) };
      const io = new DocumentIo({ ...settings, budget, signal, limits: { ...settings.limits, maxArchiveBytes: maxBytes }, ...(request.registerCleanup ? { registerCleanup: request.registerCleanup } : {}) });
      try { signal.throwIfAborted(); yield await io.readBytes(source); } finally { await io.cleanup(); }
    } }
  });
  if (output === "-" && !data.dryRun) return new Uint8Array();
  return new TextEncoder().encode(options.json ? JSON.stringify(envelope(data)) + "\n" : human(data));
}
