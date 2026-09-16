import { InputTypeError, ResourceLimitError } from "./archive.js";
import { DocumentIo, type DocumentByteSource } from "./io.js";
import type { DocxBinaryInput, DocxVfsPath } from "./operation-types.js";
import type { modelContext } from "./model-context.js";
import { modelVfsSource } from "./model-vfs.js";
import { contextData } from "./model-context.js";
import { InvalidValueError } from "./archive.js";

export type DocumentModelInput = Uint8Array | DocumentByteSource | DocxVfsPath;

/** Bounded JSON binary transport for package/template admission, never executable data. */
export async function acquireDocumentTransportInput(
  input: Uint8Array | DocxBinaryInput | DocxVfsPath,
  context: ReturnType<typeof modelContext>
): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return acquireDocumentModelInput(input, context);
  const record = contextData(input, ["kind", "base64", "path", "capability"]);
  if (record.kind === "bytes") {
    if (
      Object.keys(record).length !== 2 ||
      typeof record.base64 !== "string" ||
      record.base64.length % 4 !== 0
    )
      throw new InputTypeError("Expected canonical document base64.");
    const encoded = record.base64,
      padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0,
      size = (encoded.length / 4) * 3 - padding;
    if (size < 0 || size > context.limits.maxArchiveBytes)
      throw new ResourceLimitError("Document input byte limit exceeded.");
    context.budget.charge("retainedBytes", size * 3);
    context.budget.charge("work", encoded.length);
    let decoded: string;
    try {
      decoded = atob(encoded);
      if (btoa(decoded) !== encoded) throw new Error();
    } catch {
      throw new InvalidValueError("Expected canonical document base64.");
    }
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  }
  if (
    Object.keys(record).some((key) => !["kind", "path", "capability"].includes(key)) ||
    (record.kind !== undefined && record.kind !== "vfs") ||
    typeof record.capability !== "string"
  )
    throw new InputTypeError("Expected a declarative virtual document path.");
  return acquireDocumentModelInput(
    { path: record.path, capability: record.capability } as DocxVfsPath,
    context
  );
}

/** Admission copies bytes/chunks before crossing a caller-controlled await. */
export async function acquireDocumentModelInput(
  input: DocumentModelInput,
  context: ReturnType<typeof modelContext>
): Promise<Uint8Array> {
  const { budget, limits } = context;
  if (input instanceof Uint8Array) {
    if (input.length > limits.maxArchiveBytes)
      throw new ResourceLimitError("Document input byte limit exceeded.");
    budget.charge("retainedBytes", input.length);
    budget.charge("work", input.length);
    return new Uint8Array(input);
  }
  if (
    !input ||
    typeof input !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw new InputTypeError("Expected an explicit document input capability.");
  const record: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (
      typeof key !== "string" ||
      !["path", "capability", "open"].includes(key) ||
      !("value" in descriptor)
    )
      throw new InputTypeError("Expected finite document input data.");
    record[key] = descriptor.value;
  }
  let source: DocumentByteSource;
  if (typeof record.open === "function" && Object.keys(record).length === 1)
    source = { open: (record.open as DocumentByteSource["open"]).bind(input) };
  else {
    if (Object.keys(record).length !== 2)
      throw new InputTypeError("Expected a capability-bearing document path.");
    source = modelVfsSource(record.path, record.capability, context, limits.maxArchiveBytes);
  }
  const io = new DocumentIo(context);
  try {
    const bytes = await io.readBytes(source);
    budget.check("work", 0);
    return bytes;
  } finally {
    await io.cleanup();
  }
}
