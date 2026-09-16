import { readDocumentArchive } from "./admission.js";
import { InputTypeError } from "./archive.js";
import { createDocumentArchive } from "./create.js";
import { modelContext, type DocumentModelContext } from "./model-context.js";
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
  return { archive, settings };
}
