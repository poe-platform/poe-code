import { archiveSettings, readArchive, type DocumentArchive } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import type { AdmittedModelContext } from "./model-context.js";
import { modelOutput, type DocumentOutput, type DocumentSaveOptions } from "./model-output.js";
import { modelVfsResolver } from "./model-vfs.js";
import { publishDocumentArchive, type PublicationContext, type PublicationOptions } from "./publication.js";

export const modelSaveOperations = ["model.document.Document.save.call", "model.parts.document.DocumentPart.save.call", "model.package.Package.save.call", "model.opc.package.OpcPackage.save.call"] as const;

/** Model saves capture owned bytes; only the outer batch can publish them. */
export class ModelSaveStage {
  private archive: DocumentArchive | undefined;
  private destination: { readonly path?: string; readonly capability: string } | undefined;
  constructor(private readonly context: AdmittedModelContext) {}
  get staged(): boolean { return this.archive !== undefined; }

  async capture(output: { readonly path?: string; readonly capability: string }, save: (sink: DocumentOutput) => Promise<void>): Promise<void> {
    if (output.capability !== this.context.binaryResolver?.capability)
      throw new DocxUsageError("Unknown batch output capability token.");
    if (output.path !== undefined) modelVfsResolver(output.path, output.capability, this.context);
    if (this.destination && (this.destination.path !== output.path || this.destination.capability !== output.capability))
      throw new DocxUsageError("Model saves must use the same outer destination.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    const budget = this.context.budget;
    await save({ async write(chunk) {
      size += chunk.byteLength;
      budget.check("serializedOutput", size);
      budget.charge("retainedBytes", chunk.byteLength);
      chunks.push(new Uint8Array(chunk));
    } });
    budget.charge("retainedBytes", size);
    budget.charge("work", size);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    this.archive = await readArchive(bytes, this.context);
    this.destination = Object.freeze({ ...output });
  }

  async publish(options: PublicationOptions, context: PublicationContext) {
    if (!this.archive || !this.destination) throw new DocxUsageError("No model save has been staged.");
    const path = options.inPlace ? options.input?.path : options.output;
    if (!(options.dryRun && path === undefined) && path !== (this.destination.path ?? "-"))
      throw new DocxUsageError("Model save output must match the outer destination.");
    if (this.destination.path !== undefined && this.context.binaryResolver?.filesystem !== context.filesystem)
      throw new DocxUsageError("Model save requires the same admitted output authority.");
    const caller = archiveSettings(context), settings = this.context;
    const signal = AbortSignal.any([settings.signal, caller.signal]);
    const limits = Object.fromEntries(Object.entries(settings.limits).map(([key, value]) => [key, Math.min(value, caller.limits[key as keyof typeof caller.limits])])) as unknown as typeof settings.limits;
    const budget = settings.budget.lower(Object.fromEntries(Object.entries(settings.budget.limits).map(([key, value]) => [key, Math.min(value, caller.budget.limits[key as keyof typeof caller.budget.limits])])), signal);
    return publishDocumentArchive(this.archive, options, { ...context, limits, signal, budget, encoding: { order: "input", compression: "store" } });
  }

  async save(output: DocumentOutput, options: DocumentSaveOptions = {}): Promise<void> {
    const selected = modelOutput(output, options, this.context);
    await this.publish(selected.options, { ...this.context, ...selected, encoding: { order: "input", compression: "store" } });
  }
}
