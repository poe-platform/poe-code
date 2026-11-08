import { readDocumentArchive } from "./admission.js";
import { InputTypeError } from "./archive.js";
import { createDocumentArchive } from "./create.js";
import { contextData, modelContext, type DocumentModelContext } from "./model-context.js";
import { modelVfsResolver } from "./model-vfs.js";
import type { ModelPublicationSource } from "./model-output.js";
import { PublicationError } from "./publication.js";
import { acquireDocumentModelInput, type DocumentModelInput } from "./model-input.js";

/** Template selection is exclusive and consumed once, before model ownership. */
export async function admitDocumentModel(
  input?: DocumentModelInput | null,
  context?: DocumentModelContext
) {
  const captured = modelContext(context);
  const { template, ...rest } = captured;
  if (template !== undefined && input != null)
    throw new InputTypeError("Supply document input or a context template, not both.");
  const settings = template === undefined ? captured : modelContext(rest);
  let source: ModelPublicationSource | undefined;
  if (input != null && !(input instanceof Uint8Array)) {
    const record = contextData(input);
    if (Object.hasOwn(record, "path")) {
      contextData(input, ["path", "capability"]);
      const resolver = modelVfsResolver(record.path, record.capability, settings);
      const path = record.path as string, filesystem = resolver.filesystem;
      // Own the path and capability before the first external suspension.
      input = { path, capability: record.capability } as DocumentModelInput;
      source = { path, ...(filesystem ? { filesystem, input: { path, stat: { ...await filesystem.lstat(path, { signal: settings.signal }) } } } : {}) };
    }
  }
  const archive =
    input != null
      ? await readDocumentArchive(await acquireDocumentModelInput(input, settings), settings)
      : await createDocumentArchive(
          template === undefined
            ? {
                ...(settings.timestamp === undefined
                  ? {}
                  : { timestamp: settings.timestamp.toISOString() }),
                author: settings.author
              }
            : { template },
          settings
        );
  if (source?.input && source.filesystem) {
    const current = await source.filesystem.lstat(source.path, { signal: settings.signal });
    if ((["identityScope", "ino", "dev", "type", "revision", "size", "mode", "nlink", "mtimeMs", "ctimeMs"] as const)
      .some(key => current[key] !== source.input!.stat[key]))
      throw new PublicationError("conflict", "Input changed during admission.");
  }
  return { archive, settings, source };
}
