import type { FileSystem } from "@poe-code/safe-fs/core";
import { InputTypeError } from "./archive.js";
import type { ArchiveSink } from "./archive-write.js";
import { contextData, type AdmittedModelContext } from "./model-context.js";
import { modelVfsResolver } from "./model-vfs.js";
import type { DocxVfsPath } from "./operation-types.js";
import { PublicationError, type PublicationInput, type PublicationOptions, type ByteSink } from "./publication.js";

export type VfsPath = DocxVfsPath;
export type DocumentOutput = ByteSink | VfsPath | ArchiveSink;
export interface DocumentSaveOptions {
  readonly force?: boolean;
  readonly inPlace?: boolean;
  readonly dryRun?: boolean;
}
export interface ModelPublicationSource {
  readonly path: string;
  readonly filesystem?: FileSystem;
  readonly input?: PublicationInput;
}

/** Resolve only caller-granted authority; never discover a host filesystem. */
export function modelOutput(output: DocumentOutput, flags: DocumentSaveOptions, context: AdmittedModelContext, source?: ModelPublicationSource) {
  const options = contextData(flags, ["force", "inPlace", "dryRun"]) as DocumentSaveOptions;
  if (!output || (typeof output !== "object" && typeof output !== "function"))
    throw new InputTypeError("Expected an explicit document output capability.");
  if ("path" in output || "capability" in output) {
    const record = contextData(output, ["path", "capability"]);
    const resolver = modelVfsResolver(record.path, record.capability, context);
    const filesystem = resolver.filesystem;
    if (!filesystem) throw new PublicationError("unsupported-publication", "Virtual output requires explicit publication authority.");
    if (source && (!source.input || source.filesystem !== filesystem))
      throw new PublicationError("unsupported-publication", "Input identity requires the same admitted filesystem authority.");
    if (options.inPlace && (!source || source.path !== record.path))
      throw new PublicationError("conflict", "In-place output must name the admitted input.");
    const publication: PublicationOptions = { ...options,
      ...(source?.input ? { input: source.input } : {}),
      ...(options.inPlace ? {} : { output: record.path as string }) };
    return { options: publication, filesystem };
  }
  if (options.inPlace || options.force) throw new InputTypeError("Stream output cannot use path replacement intent.");
  return { options: { ...options, output: "-" } as PublicationOptions, stdout: output as ByteSink | ArchiveSink };
}
