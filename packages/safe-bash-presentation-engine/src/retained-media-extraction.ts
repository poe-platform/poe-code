import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { ByteSource } from "./contracts.js";
import type { RetainedPackageArchive, RetainedPackageContext } from "./retained-package.js";
import type { XmlRange } from "./retained-xml.js";
import { OfficeError } from "./errors.js";
import { openRetainedMedia } from "./retained-media.js";
import {
  validateMediaExtractionOptions,
  mediaExtensions,
  type ExtractMediaOptions
} from "./media-extraction.js";
import { resourceContext } from "./resource-limits.js";
import { RetainedValues, equal, literal } from "./retained-values.js";
type Archive = Pick<RetainedPackageArchive, "parts" | "has" | "read" | "byteLength">;
export interface RetainedExtractedMediaMember {
 readonly part:string;readonly name:string;readonly size:number;readonly sha256:string;
 readonly contentType:(()=>ByteSource)|null;
 sourceParts():AsyncGenerator<()=>ByteSource>;
 occurrenceIds():AsyncGenerator<()=>ByteSource>;
 bytes():ByteSource;
}
type Metadata = {
  part: string;
  name: string;
  size: number;
  sha256: string;
  contentType: XmlRange | null;
};
async function* joined(...sources: ByteSource[]): ByteSource {
  for (const source of sources) yield* source;
}

/** Admit extraction order, grouping and provenance in caller storage. Archive ownership stays with the caller. */
export async function openRetainedMediaExtraction(
  archive: Archive,
  fingerprint: string,
  options: ExtractMediaOptions = {},
  settings: RetainedPackageContext
) {
  const context = { ...resourceContext(settings), workingStorage: { ...settings.workingStorage } },
    signal = context.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  validateMediaExtractionOptions(options);
  const { maxOutputBytes = Infinity, maxOutputs = Infinity, deduplicate, ...selection } = options;
  const reader = await openRetainedMedia(archive, fingerprint, selection, context);
  const pages = new PagedStorage(
    { fs: context.workingStorage.fs, cwd: context.workingStorage.directory, env: {}, signal },
    (context.workingStorage.cacheBytes ?? 1024 * 1024) / 16384
  );
  let closed = false,
    closing: Promise<void> | undefined,
    head = 0,
    tail = 0,
    count = 0,
    total = 0;
  const check = () => {
    if (closed) throw new OfficeError("invalid-handle", "Media extraction is closed.", "serialize");
    if (signal.aborted) throw new OfficeError("cancelled", "Operation cancelled.", "serialize");
  };
  const failure = (error: unknown) =>
    error instanceof OfficeError
      ? error
      : new OfficeError(
          signal.aborted ? "cancelled" : "io-failure",
          "Media extraction storage operation failed.",
          "serialize"
        );
  const close = () => {
    closed = true;
    return (closing ??= (async () => {
      const results = await Promise.allSettled([reader.close(), pages.close()]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
    })());
  };
  const values = new RetainedValues(pages, check, signal);
  async function write(pointer: number, numbers: number[]) {
    check();
    const bytes = new Uint8Array(numbers.length * 8),
      view = new DataView(bytes.buffer);
    numbers.forEach((n, i) => view.setFloat64(i * 8, n, true));
    await pages.write(pointer, bytes);
  }
  async function row(pointer: number, length: number) {
    check();
    const bytes = await pages.read(pointer, length * 8),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length }, (_, i) => view.getFloat64(i * 8, true));
  }
  async function text(range: XmlRange) {
    let value = "";
    const decoder = new TextDecoder();
    for await (const bytes of values.read(range)) value += decoder.decode(bytes, { stream: true });
    return value + decoder.decode();
  }
  async function provenance(group: number, field: 3 | 5, key: XmlRange) {
    if (!(await values.insert("group:" + group + ":" + field, key, key))) return;
    const entry = pages.allocate(24);
    await write(entry, [0, key.start, key.length]);
    const links = await row(group, 7);
    if (links[field + 1]) await write(links[field + 1]!, [entry]);
    else await write(group + field * 8, [entry]);
    await write(group + (field + 1) * 8, [entry]);
  }
  try {
    for await (const ref of reader.resources()) {
      check();
      if (ref.external || !ref.part || !ref.sha256 || ref.bytes === null)
        throw new OfficeError(
          "unsupported-edit",
          "External media requires explicit local bytes for extraction.",
          "select"
        );
      const part = await values.store(literal(ref.part));
      if (!(await values.insert("seen:" + ref.occurrence, part, part))) continue;
      const identity = () =>
        joined(ref.contentType ? ref.contentType() : literal(""), literal(":" + ref.sha256));
      let group = deduplicate ? (await values.find("hashes", identity))?.start : undefined;
      if (!group) {
        total += ref.bytes;
        if (!Number.isSafeInteger(total) || total > maxOutputBytes || count >= maxOutputs)
          throw new OfficeError(
            "resource-limit",
            "Media extraction output limit exceeded.",
            "serialize"
          );
        let extension = "bin";
        if (ref.contentType)
          for (const [type, suffix] of mediaExtensions)
            if (await equal(ref.contentType(), literal(type))) {
              extension = suffix;
              break;
            }
        const type = ref.contentType ? await values.store(ref.contentType()) : null;
        const metadata: Metadata = {
          part: ref.part,
          name: "part-" + String(++count).padStart(6, "0") + "." + extension,
          size: ref.bytes,
          sha256: ref.sha256,
          contentType: type
        };
        const saved = await values.store(literal(JSON.stringify(metadata)));
        group = pages.allocate(56);
        await write(group, [0, saved.start, saved.length, 0, 0, 0, 0]);
        if (tail) await write(tail, [group]);
        else head = group;
        tail = group;
        if (deduplicate) {
          const key = await values.store(identity());
          await values.insert("hashes", key, { start: group, length: 56 });
        }
      }
      await provenance(group, 3, part);
      await provenance(group, 5, await values.store(ref.occurrenceId()));
    }
    await reader.close();
    check();
    async function* list(pointer: number) {
      check();
      for (; pointer; ) {
        const item = await row(pointer, 3);
        pointer = item[0]!;
        const range = { start: item[1]!, length: item[2]! };
        yield () => values.read(range);
      }
      check();
    }
    return Object.freeze({
      close,
      count,
      async *members():AsyncGenerator<RetainedExtractedMediaMember> {
        try {
          check();
          for (let pointer = head; pointer; ) {
            const item = await row(pointer, 7);
            pointer = item[0]!;
            const metadata = JSON.parse(
              await text({ start: item[1]!, length: item[2]! })
            ) as Metadata;
            yield {
              ...metadata,
              contentType: metadata.contentType ? () => values.read(metadata.contentType!) : null,
              sourceParts: () => list(item[3]!),
              occurrenceIds: () => list(item[5]!),
              async *bytes() {
                check();
                for await (const bytes of archive.read(metadata.part)) {
                  check();
                  yield bytes;
                }
                check();
              }
            };
          }
          check();
        } catch (error) {
          throw failure(error);
        }
      }
    });
  } catch (error) {
    await close().catch(() => {});
    throw failure(error);
  }
}
