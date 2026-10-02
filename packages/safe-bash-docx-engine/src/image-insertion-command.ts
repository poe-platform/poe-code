import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import { archiveSettings, type ArchiveContext } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import type { DocxInvocation } from "./command.js";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";
import { insertDocumentImage, type ImageInsertionData } from "./image-insertion.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import { DocumentIo } from "./io.js";
import type { DocxBinaryInput, DocxOperationArguments } from "./operation-types.js";
import { UnsupportedProfileError } from "./package-xml.js";
import { PublicationError, type PublicationInput } from "./publication.js";

/** Adapts an explicit virtual command image source to the original insertion utility. */
export async function executeImageInsertionCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined, request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  if (invocation.operation !== "images.add") throw new DocxUsageError("Expected image insertion.");
  const settings = archiveSettings(context), options = invocation.options as DocxOperationArguments<"images.add">;
  const budget = settings.budget.lower(Object.fromEntries((options.limit ?? []).map(item => [item.name, item.value])));
  const output = options.output === undefined || options.output === "-" ? options.output : resolvePath(request.cwd, options.output);
  const normalizeSource = (source: DocxBinaryInput | undefined, argument: string): DocxBinaryInput | undefined => {
    if (source?.kind !== "vfs" || source.capability !== "command") return source;
    const reserved = source.path === "-" && invocation.sources?.some(item => item.argument === argument && item.format === "binary" && item.path === "-");
    return { ...source, path: reserved ? "-" : resolvePath(request.cwd, source.path) };
  };
  const file = normalizeSource(options.file, "file")!, fallback = normalizeSource(options.fallback, "fallback");
  if ((options.inPlace || output !== undefined && output !== "-") && invocation.inputs[0] !== "-" && !input) throw new PublicationError("unsupported-publication", "Image publication requires admitted input identity.");
  const envelope = (data: ImageInsertionData) => ({ version: 1, operation: invocation.operation, ok: true, data, affected: data.changes.length, locations: data.changes.map(c => c.after), warnings: [], errors: [] });
  const human = (data: ImageInsertionData) => `docx images add: ${data.dryRun ? "dry-run; " : ""}${data.changes.length} ${data.changes.length === 1 ? "selection" : "selections"} changed\n`;
  const data = await insertDocumentImage(bytes, { operation: "images.add", options: { ...options, file, ...(fallback === undefined ? {} : { fallback }), ...(output === undefined ? {} : { output }) }, ...(input ? { input } : {}) }, {
    ...settings, budget, encoding: { order: "input", compression: "store" }, filesystem: request.filesystem as FileSystem, stdout: request.stdout,
    admitPublication(planned): undefined {
      const size = output === "-" && !planned.dryRun ? 0 : options.json ? measurePackageResourceSerialization(envelope(planned), budget) + 1 : new TextEncoder().encode(human(planned)).length;
      const diagnosticSize = new TextEncoder().encode("docx: unsupported-publication: Document operation failed: unsupported-publication\n").length;
      budget.check("serializedOutput", size); budget.check("diagnosticBytes", diagnosticSize); budget.charge("retainedBytes", size * 8 + diagnosticSize * 8); budget.charge("work", size * 8 + diagnosticSize * 8);
      return undefined;
    },
    binaryResolver: { capability: "command", async *open(path, { signal, maxBytes }) {
      const readStream = request.filesystem.readStream;
      if (path !== "-" && !readStream) throw new UnsupportedProfileError("Image paths require an explicit streaming read capability.");
      const source = { open: (inner: AbortSignal) => path === "-" ? request.stdin : readStream!.call(request.filesystem, resolvePath(request.cwd, path), { signal: inner }) };
      const io = new DocumentIo({ ...settings, budget, signal, limits: { ...settings.limits, maxArchiveBytes: maxBytes }, ...(request.registerCleanup ? { registerCleanup: request.registerCleanup } : {}) });
      try { signal.throwIfAborted(); yield await io.readBytes(source); } finally { await io.cleanup(); }
    } }
  });
  if (output === "-" && !data.dryRun) return new Uint8Array();
  return new TextEncoder().encode(options.json ? JSON.stringify(envelope(data)) + "\n" : human(data));
}
