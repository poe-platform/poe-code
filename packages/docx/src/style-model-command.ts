import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import { archiveSettings, type ArchiveContext } from "./archive.js";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import { PublicationError, type PublicationInput, type PublicationOptions } from "./publication.js";
import { applyStyleModelBatch } from "./style-model-batch.js";

export async function executeStyleModelCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined, request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  const options = invocation.options;
  const model = await applyStyleModelBatch(bytes, { version: options.version, operations: options.operations }, context);
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
