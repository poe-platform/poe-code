import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import { archiveSettings, type ArchiveContext } from "./archive.js";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import { PublicationError, type PublicationInput } from "./publication.js";
import { executeDocumentBatch, type DocumentBatchOptions } from "./batch.js";
import { DocumentIo } from "./io.js";
import { UnsupportedProfileError } from "./package-xml.js";

export async function executeStyleModelCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined, request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  const options = invocation.options;
  const settings = archiveSettings(context);
  const operations = (options.operations as readonly { operation: string; arguments: Record<string, unknown> }[]).map(item => {
    const descriptor = item.arguments.imageDescriptor;
    if (item.operation !== "model.image.image.Image.from_file.call" || !descriptor || typeof descriptor !== "object" || !("path" in descriptor) || !("capability" in descriptor) || descriptor.capability !== "command") return item;
    return { ...item, arguments: { ...item.arguments, imageDescriptor: { ...descriptor, path: resolvePath(request.cwd, descriptor.path as string) } } };
  });
  const output = options.output === undefined ? undefined : options.output === "-" ? "-" : resolvePath(request.cwd, options.output as string);
  if ((options.inPlace || output !== undefined && output !== "-") && invocation.inputs[0] !== "-" && !input)
    throw new PublicationError("unsupported-publication", "File publication requires admitted input identity.");
  const {version, operations: ignoredOperations, ...intent} = options;
  const data = await executeDocumentBatch(bytes, {version, operations}, {...intent, ...(input ? {input} : {}), ...(output === undefined ? {} : {output})} as DocumentBatchOptions, { ...context,
    encoding: {order: "input", compression: "store"}, filesystem: request.filesystem as FileSystem, stdout: request.stdout,
    ...(request.registerCleanup ? {registerCleanup: request.registerCleanup} : {}),
    binaryResolver: { capability: "command", filesystem: request.filesystem as FileSystem, async *open(path, { signal, maxBytes }) {
      const readStream = request.filesystem.readStream;
      if (!readStream) throw new UnsupportedProfileError("Image paths require an explicit streaming read capability.");
      const source = { open: (inner: AbortSignal) => readStream.call(request.filesystem, path, { signal: inner }) };
      const io = new DocumentIo({ ...settings, signal, limits: { ...settings.limits, maxArchiveBytes: maxBytes }, ...(request.registerCleanup ? { registerCleanup: request.registerCleanup } : {}) });
      try { signal.throwIfAborted(); yield await io.readBytes(source); } finally { await io.cleanup(); }
    } }
  });
  if (data.publication && output === "-" && !options.dryRun) return new Uint8Array();
  const affected = data.results.reduce((sum, result) => sum + result.affected, 0);
  return new TextEncoder().encode(options.json ? JSON.stringify({ version: 1, operation: "batch", ok: true, data, warnings: [], errors: [], affected, locations: [] }) + "\n"
    : `docx batch: ${options.dryRun ? "dry-run; " : ""}${data.results.length} operations; ${affected} changes\n`);
}
