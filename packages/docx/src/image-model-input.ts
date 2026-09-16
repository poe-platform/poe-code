import type { ByteSource } from "@poe-code/office-package";
import { InputTypeError, InvalidValueError, ResourceLimitError, type ArchiveContext } from "./archive.js";
import { documentLimitDefaults } from "./budget.js";
import { modelContext, type DocumentModelContext } from "./model-context.js";
import { DocumentIo, type DocumentByteSource } from "./io.js";
import type { DocxBinaryInput, DocxVfsPath } from "./operation-types.js";
import { UnsupportedEditError } from "./xml-write.js";

export interface ImageModelContext extends DocumentModelContext {
  readonly binaryResolver?: { readonly capability: string; open(path: string, options: { readonly signal: AbortSignal; readonly maxBytes: number }): ByteSource | Promise<ByteSource> };
  readonly registerCleanup?: (cleanup: () => Promise<void>) => void;
}
export type ImageModelInput = Uint8Array | DocumentByteSource | DocxVfsPath;
export interface ImageModelAcquisition { readonly bytes: Uint8Array; readonly filename: string | null; readonly context: ArchiveContext }

/** Acquires owned bytes; the image factory subsequently charges admitted media. */
export async function acquireImageModelInput(input: ImageModelInput | DocxBinaryInput, context?: ImageModelContext): Promise<ImageModelAcquisition> {
  context = context ?? {};
  const settings = modelContext(context, { maxEntryBytes: documentLimitDefaults.embeddedMediaBytes, maxExtraBytes: 0, maxCommentBytes: 0 }), { budget, limits, signal } = settings;
  const maxBytes = Math.min(limits.maxEntryBytes, budget.limits.embeddedMediaBytes - budget.usage.embeddedMediaBytes); let bytes: Uint8Array, filename: string | null = null;
  if (input instanceof Uint8Array) {
    if (input.length > maxBytes) throw new ResourceLimitError("Image input exceeds the media byte limit.");
    budget.charge("retainedBytes", input.length); budget.charge("work", input.length); bytes = new Uint8Array(input);
  } else {
    if (!input || typeof input !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new InputTypeError("Expected an explicit image input capability.");
    const record: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(input)) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
      if (typeof key !== "string" || !["kind", "base64", "path", "capability", "open"].includes(key) || !("value" in descriptor)) throw new InputTypeError("Expected finite image input data.");
      record[key] = descriptor.value;
    }
    if (record.kind === "bytes") {
      if (Object.keys(record).some(key => key !== "kind" && key !== "base64") || typeof record.base64 !== "string" || record.base64.length % 4 !== 0) throw new InvalidValueError("Expected canonical image base64.");
      const encoded = record.base64, padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0, size = encoded.length / 4 * 3 - padding;
      if (size > maxBytes) throw new ResourceLimitError("Image input exceeds the media byte limit.");
      budget.charge("retainedBytes", size * 3); budget.charge("work", encoded.length);
      let decoded: string; try { decoded = atob(encoded); if (btoa(decoded) !== encoded) throw new Error(); } catch { throw new InvalidValueError("Expected canonical image base64."); }
      bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
    } else {
      let source: DocumentByteSource;
      if (typeof record.open === "function" && Object.keys(record).length === 1) source = { open: (record.open as DocumentByteSource["open"]).bind(input) };
      else {
        if (Object.keys(record).some(key => !["kind", "path", "capability"].includes(key)) || record.kind !== undefined && record.kind !== "vfs" || typeof record.path !== "string" || typeof record.capability !== "string" || !record.capability) throw new InputTypeError("Expected a capability-bearing image path.");
        const path = record.path;
        if (path.length > limits.maxPathBytes) throw new ResourceLimitError("Image path exceeds the virtual path byte limit.");
        budget.charge("work", path.length); let pathBytes = 0;
        for (let index = 0; index < path.length; index++) { const point = path.codePointAt(index)!; pathBytes += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4; if (point > 65535) index++; }
        if (pathBytes > limits.maxPathBytes) throw new ResourceLimitError("Image path exceeds the virtual path byte limit.");
        budget.charge("retainedBytes", path.length * 4);
        if (!path.startsWith("/") || path.includes("\0") || path.slice(1).split("/").some(part => !part || part === "." || part === "..")) throw new InvalidValueError("Expected a canonical virtual image path.");
        const resolver = settings.binaryResolver;
        if (!resolver || resolver.capability !== record.capability) throw new UnsupportedEditError("Image paths require a matching explicit capability.");
        filename = path.slice(path.lastIndexOf("/") + 1);
        source = { open(inner) { return { async *[Symbol.asyncIterator]() { yield* await resolver.open(path, { signal: inner, maxBytes }); } }; } };
      }
      if (maxBytes < 1) throw new ResourceLimitError("Image input exceeds the media byte limit.");
      const io = new DocumentIo({ ...settings, limits: { ...limits, maxArchiveBytes: maxBytes }, ...(settings.registerCleanup ? { registerCleanup: settings.registerCleanup } : {}) });
      try { bytes = await io.readBytes(source); } finally { await io.cleanup(); }
    }
  }
  budget.check("work", 0); return { bytes, filename, context: { limits, signal, budget } };
}
