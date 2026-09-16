import { DocxUsageError } from "./argument-json.js";
import { modelContext } from "./model-context.js";
import { documentLimitDefaults, type DocumentLimits } from "./budget.js";
import { Image, acquireImageModelInput, type ImageModelContext } from "./image-model.js";
import type { DocxBinaryInput, DocxVfsPath, DocxLength } from "./operation-types.js";

type Action = (receiver: unknown, args: Readonly<Record<string, unknown>>, context: ImageModelContext) => unknown;
export const imageBatchActions = new Map<string, Action>();
const prefix = "model.image.image.Image";
function narrowed(context: ImageModelContext, input: unknown): ImageModelContext {
  const settings = modelContext(context, { maxEntryBytes: documentLimitDefaults.embeddedMediaBytes, maxExtraBytes: 0, maxCommentBytes: 0 });
  if (input === undefined) return { ...context, ...settings };
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new DocxUsageError("Expected image context.");
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== "limits" && key !== "vfs")) throw new DocxUsageError("Image context accepts only limits and an existing VFS capability.");
  if (record.vfs !== undefined && record.vfs !== context.binaryResolver?.capability) throw new DocxUsageError("Unknown image VFS capability.");
  const budget = settings.budget.lower((record.limits ?? {}) as Partial<DocumentLimits>, settings.signal);
  return { ...context, ...settings, budget };
}
imageBatchActions.set(`${prefix}.from_blob.call`, async (_receiver, args, context) => {
  if (!(args.blob instanceof Uint8Array) && (!args.blob || typeof args.blob !== "object" || (args.blob as Record<string, unknown>).kind !== "bytes")) throw new DocxUsageError("Image.from_blob requires owned bytes.");
  const selected = narrowed(context, args.context);
  const acquired = await acquireImageModelInput(args.blob as Uint8Array | DocxBinaryInput, selected);
  return Image.from_blob(acquired.bytes, acquired.context);
});
imageBatchActions.set(`${prefix}.from_file.call`, async (_receiver, args, context) => {
  const selected = narrowed(context, args.context);
  const descriptor = args.imageDescriptor as Uint8Array | DocxBinaryInput | DocxVfsPath;
  if (!(descriptor instanceof Uint8Array) && "path" in descriptor) return Image.from_file({ path: descriptor.path, capability: descriptor.capability }, selected);
  const acquired = await acquireImageModelInput(descriptor, selected);
  return Image.from_blob(acquired.bytes, acquired.context);
});
for (const name of ["blob", "content_type", "ext", "filename", "px_width", "px_height", "horz_dpi", "vert_dpi", "width", "height", "sha1"] as const) {
  imageBatchActions.set(`${prefix}.${name}.get`, receiver => {
    if (!(receiver instanceof Image)) throw new DocxUsageError("The receiver is not an admitted Image.");
    return receiver[name];
  });
}
imageBatchActions.set(`${prefix}.scaled_dimensions.call`, (receiver, args) => {
  if (!(receiver instanceof Image)) throw new DocxUsageError("The receiver is not an admitted Image.");
  return receiver.scaled_dimensions(args.width as number | DocxLength | null | undefined, args.height as number | DocxLength | null | undefined);
});
