import { archiveSettings, CancellationError, ResourceLimitError, type ArchiveContext, type DocumentArchive } from "./archive.js";
import { writeArchive, type ArchiveSink, type ArchiveWriteOptions } from "./archive-write.js";
import { SemanticValidationError, validateDocumentArchive } from "./validation.js";

export async function writeDocumentArchive(
  archive: DocumentArchive,
  sink: ArchiveSink,
  options: ArchiveWriteOptions,
  context: ArchiveContext
): Promise<void> {
  const { limits, signal } = archiveSettings(context);
  if (signal.aborted) throw new CancellationError("Document publication cancelled.");
  // Validation completes synchronously; the archive writer owns bytes before suspending.
  const total = archive?.members?.reduce((sum, member) => sum + (member.bytes?.length ?? 0), 0) ?? 0;
  if (total * 32 + 65536 > limits.maxRetainedBytes)
    throw new ResourceLimitError("Document validation retained byte limit exceeded.");
  const report = validateDocumentArchive(archive, { maxBytes: Math.min(limits.maxTotalBytes, 32 * 1024 * 1024), maxParts: Math.min(limits.maxMembers, 4096) });
  if (!report.valid) throw new SemanticValidationError(report.diagnostics);
  await writeArchive(archive, sink, options, context);
}
