import { InputTypeError, InvalidValueError, ResourceLimitError } from "./archive.js";
import { DocumentIo, type DocumentByteSource } from "./io.js";
import type { DocxVfsPath } from "./operation-types.js";
import type { modelContext } from "./model-context.js";
import { UnsupportedEditError } from "./xml-write.js";

export type DocumentModelInput = Uint8Array | DocumentByteSource | DocxVfsPath;

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
    if (
      Object.keys(record).length !== 2 ||
      typeof record.path !== "string" ||
      typeof record.capability !== "string" ||
      !record.capability
    )
      throw new InputTypeError("Expected a capability-bearing document path.");
    const path = record.path;
    if (
      path.length > limits.maxPathBytes ||
      new TextEncoder().encode(path).length > limits.maxPathBytes
    )
      throw new ResourceLimitError("Document path byte limit exceeded.");
    if (
      !path.startsWith("/") ||
      path.includes("\0") ||
      path
        .slice(1)
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    )
      throw new InvalidValueError("Expected a canonical virtual document path.");
    const resolver = context.binaryResolver;
    if (!resolver || resolver.capability !== record.capability)
      throw new UnsupportedEditError("Document paths require a matching explicit capability.");
    source = {
      open(inner) {
        return {
          async *[Symbol.asyncIterator]() {
            yield* await resolver.open(path, { signal: inner, maxBytes: limits.maxArchiveBytes });
          }
        };
      }
    };
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
