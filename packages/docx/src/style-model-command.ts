import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import { archiveSettings, type ArchiveContext } from "./archive.js";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import { PublicationError, type PublicationInput, type PublicationOptions } from "./publication.js";
import { applyStyleModelBatch } from "./style-model-batch.js";
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
  const model = await applyStyleModelBatch(bytes, { version: options.version, operations }, { ...context,
    ...(options.timestamp === undefined ? {} : { timestamp: new Date(options.timestamp as string) }),
    ...(options.author === undefined ? {} : { author: options.author as string }),
    ...(request.registerCleanup ? { registerCleanup: request.registerCleanup } : {}),
    binaryResolver: { capability: "command", async *open(path, { signal, maxBytes }) {
      const readStream = request.filesystem.readStream;
      if (!readStream) throw new UnsupportedProfileError("Image paths require an explicit streaming read capability.");
      const source = { open: (inner: AbortSignal) => readStream.call(request.filesystem, path, { signal: inner }) };
      const io = new DocumentIo({ ...settings, signal, limits: { ...settings.limits, maxArchiveBytes: maxBytes }, ...(request.registerCleanup ? { registerCleanup: request.registerCleanup } : {}) });
      try { signal.throwIfAborted(); yield await io.readBytes(source); } finally { await io.cleanup(); }
    } }
  });
  const output = options.output === undefined ? undefined : options.output === "-" ? "-" : resolvePath(request.cwd, options.output as string);
  if (model.affected && (options.inPlace || output !== undefined && output !== "-") && invocation.inputs[0] !== "-" && !input)
    throw new PublicationError("unsupported-publication", "File publication requires admitted input identity.");
  const warnings = model.warnings.map(warning => ({ code: warning.code, message: "Style ID lookup is deprecated; use a style name." }));
  const budget = archiveSettings(context).budget;
  budget.check("serializedOutput", new TextEncoder().encode(JSON.stringify({ version: 1, operation: "batch", ok: true,
    data: { results: model.results, dryRun: options.dryRun === true, output: [{ path: output ?? input?.path ?? "", bytes: context.limits.maxArchiveBytes }] },
    warnings, errors: [], affected: model.affected, locations: [] }) + "\n").length);
  const publication: PublicationOptions = { ...(input ? { input } : {}), ...(output === undefined ? {} : { output }),
    ...(options.inPlace === undefined ? {} : { inPlace: options.inPlace as boolean }), ...(options.force === undefined ? {} : { force: options.force as boolean }),
    ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun as boolean }), ...(options.json === undefined ? {} : { json: options.json as boolean }) };
  const published = model.affected ? await model.publish(publication, { ...context, encoding: { order: "input", compression: "store" }, filesystem: request.filesystem as FileSystem, stdout: request.stdout }) : null;
  if (model.affected && output === "-" && !options.dryRun) return new Uint8Array();
  const data = { results: model.results, dryRun: options.dryRun === true, output: published?.published ?? [] };
  return new TextEncoder().encode(options.json ? JSON.stringify({ version: 1, operation: "batch", ok: true, data, warnings, errors: [], affected: model.affected, locations: [] }) + "\n"
    : `docx batch: ${options.dryRun ? "dry-run; " : ""}${model.results.length} operations; ${model.affected} changes\n`);
}
