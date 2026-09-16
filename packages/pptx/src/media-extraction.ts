import type { BinaryInput } from "./contracts.js";
import { readBinary } from "./bytes.js";
import { OfficeError } from "./errors.js";
import { readMedia, type MediaRelationship, type ReadMediaOptions } from "./media.js";
import { readPackage } from "./package-reader.js";
import type { SelectionContext } from "./selectors.js";

export interface ExtractMediaOptions extends ReadMediaOptions {
  readonly maxOutputBytes: number;
  readonly maxOutputs: number;
  readonly deduplicate?: boolean;
}
export interface ExtractedMedia {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly contentType: string | null;
  readonly sourceParts: readonly string[];
  readonly occurrenceIds: readonly string[];
}
const extensions = new Map([
  ["video/mp4", "mp4"],
  ["audio/mp4", "m4a"],
  ["video/quicktime", "mov"],
  ["video/mpeg", "mpeg"],
  ["audio/mpeg", "mp3"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["video/x-msvideo", "avi"],
  ["video/x-ms-wmv", "wmv"],
  ["audio/x-ms-wma", "wma"],
  ["video/webm", "webm"],
  ["audio/webm", "webm"],
  ["video/ogg", "ogv"],
  ["audio/ogg", "ogg"]
]);

export async function extractMedia(
  input: BinaryInput,
  options: ExtractMediaOptions,
  context: SelectionContext
): Promise<readonly ExtractedMedia[]> {
  context.signal?.throwIfAborted();
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some(
      (key) =>
        typeof key !== "string" ||
        ![
          "scope",
          "slide",
          "shape",
          "select",
          "maxOutputBytes",
          "maxOutputs",
          "deduplicate"
        ].includes(key) ||
        !("value" in Object.getOwnPropertyDescriptor(options, key)!)
    ) ||
    ![options.maxOutputBytes, options.maxOutputs].every(
      (value) => Number.isSafeInteger(value) && value > 0
    ) ||
    (options.deduplicate !== undefined && typeof options.deduplicate !== "boolean")
  )
    throw new OfficeError("invalid-value", "Invalid media extraction options or limits.", "usage");
  const { maxOutputBytes, maxOutputs, deduplicate, ...selection } = options;
  const source = await readBinary(input, context);
  const inventory = await readMedia(source, selection, context);
  const groups: { ref: MediaRelationship; parts: Set<string>; ids: Set<string> }[] = [];
  const hashes = new Map<string, (typeof groups)[number]>();
  let total = 0;
  let processed = 0;
  for (const occurrence of inventory.occurrences) {
    const seen = new Set<string>();
    for (const ref of occurrence.relationships) {
      if (++processed % 64 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      context.signal?.throwIfAborted();
      if (ref.external || !ref.mediaPart || !ref.sha256 || ref.bytes === null)
        throw new OfficeError(
          "unsupported-edit",
          "External media requires explicit local bytes for extraction.",
          "select"
        );
      if (seen.has(ref.mediaPart)) continue;
      seen.add(ref.mediaPart);
      const key = `${ref.contentType ?? ""}:${ref.sha256}`;
      const existing = deduplicate ? hashes.get(key) : undefined;
      if (existing) {
        existing.parts.add(ref.mediaPart);
        existing.ids.add(occurrence.id);
        continue;
      }
      total += ref.bytes;
      if (
        !Number.isSafeInteger(total) ||
        total > maxOutputBytes ||
        groups.length >= Math.min(maxOutputs, 999999)
      )
        throw new OfficeError(
          "resource-limit",
          "Media extraction output limit exceeded.",
          "serialize"
        );
      const group = { ref, parts: new Set([ref.mediaPart]), ids: new Set([occurrence.id]) };
      groups.push(group);
      hashes.set(key, group);
    }
  }
  const reader = await readPackage(source, context);
  const outputs: ExtractedMedia[] = [];
  for (const [index, group] of groups.entries()) {
    if (index > 0 && index % 64 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    context.signal?.throwIfAborted();
    outputs.push({
      name: `part-${String(index + 1).padStart(6, "0")}.${extensions.get(group.ref.contentType ?? "") ?? "bin"}`,
      bytes: reader.get(group.ref.mediaPart!),
      sha256: group.ref.sha256!,
      contentType: group.ref.contentType,
      sourceParts: [...group.parts],
      occurrenceIds: [...group.ids]
    });
  }
  return outputs;
}
