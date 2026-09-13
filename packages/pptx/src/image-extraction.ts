import type { BinaryInput } from "./contracts.js";
import { readBinary } from "./bytes.js";
import { OfficeError } from "./errors.js";
import {
  readImages,
  validateImageSelectionOptions,
  type ImageOccurrence,
  type ReadImagesOptions
} from "./images.js";
import { readPackage } from "./package-reader.js";
import type { SelectionContext } from "./selectors.js";

export interface ExtractImagesOptions extends ReadImagesOptions {
  readonly sha256?: string;
  readonly maxOutputBytes: number;
  readonly maxOutputs: number;
}
export interface ExtractedImage {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly contentType: string | null;
  readonly sourceParts: readonly string[];
  readonly occurrences: readonly ImageOccurrence[];
}
const extensions = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/bmp", "bmp"],
  ["image/tiff", "tiff"],
  ["image/svg+xml", "svg"],
  ["image/x-emf", "emf"],
  ["image/emf", "emf"],
  ["image/x-wmf", "wmf"],
  ["image/wmf", "wmf"],
  ["image/vnd.ms-photo", "wdp"]
]);

export async function extractImages(
  input: BinaryInput,
  options: ExtractImagesOptions,
  context: SelectionContext
): Promise<readonly ExtractedImage[]> {
  if (
    !options ||
    typeof options !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    ![options.maxOutputBytes, options.maxOutputs].every(
      (value) => Number.isSafeInteger(value) && value > 0
    )
  )
    throw new OfficeError(
      "invalid-value",
      "Explicit positive extraction limits are required.",
      "usage"
    );
  const { maxOutputBytes, maxOutputs, sha256, ...selection } = options;
  if (
    sha256 !== undefined &&
    (typeof sha256 !== "string" ||
      sha256.length !== 64 ||
      [...sha256].some((x) => !"0123456789abcdef".includes(x)))
  )
    throw new OfficeError(
      "invalid-value",
      "Image hashes require 64 lowercase hexadecimal digits.",
      "usage"
    );
  validateImageSelectionOptions(selection);
  const source = await readBinary(input, context);
  const inventory = await readImages(source, selection, context);
  const groups: ImageOccurrence[][] = [];
  const hashes = new Map<string, ImageOccurrence[]>();
  let total = 0;
  const selected =
    sha256 === undefined
      ? inventory.occurrences
      : inventory.occurrences.filter((x) => x.sha256 === sha256);
  if (sha256 !== undefined && !selected.length)
    throw new OfficeError(
      "missing-selection",
      "No image matches the selected hash in this scope.",
      "select"
    );
  let processed = 0;
  for (const occurrence of selected) {
    if (++processed % 64 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    context.signal?.throwIfAborted();
    if (
      occurrence.external ||
      !occurrence.mediaPart ||
      !occurrence.sha256 ||
      occurrence.bytes === null
    )
      throw new OfficeError(
        "unsupported-edit",
        "External images cannot be extracted without explicit local bytes.",
        "select"
      );
    const existing = selection.unique ? hashes.get(occurrence.sha256) : undefined;
    if (existing) {
      existing.push(occurrence);
      continue;
    }
    total += occurrence.bytes;
    if (
      !Number.isSafeInteger(total) ||
      total > maxOutputBytes ||
      groups.length >= Math.min(maxOutputs, 999999)
    )
      throw new OfficeError(
        "resource-limit",
        "Image extraction output limit exceeded.",
        "serialize"
      );
    const group = [occurrence];
    groups.push(group);
    hashes.set(occurrence.sha256, group);
  }
  const reader = await readPackage(source, context);
  const outputs: ExtractedImage[] = [];
  for (const [index, occurrences] of groups.entries()) {
    if (index > 0 && index % 64 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    context.signal?.throwIfAborted();
    const first = occurrences[0]!;
    const contentType = occurrences.every((x) => x.contentType === first.contentType)
      ? first.contentType
      : null;
    outputs.push({
      name: `part-${String(index + 1).padStart(6, "0")}.${extensions.get(contentType ?? "") ?? "bin"}`,
      bytes: reader.get(first.mediaPart!),
      sha256: first.sha256!,
      contentType,
      sourceParts: [...new Set(occurrences.map((x) => x.mediaPart!))],
      occurrences
    });
  }
  return outputs;
}
