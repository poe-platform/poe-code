import { PagedStorage } from "@poe-code/safe-fs/storage";
import { sha1 } from "@noble/hashes/legacy.js";
import { readImageMetadata } from "./image-metadata.js";
import type { RetainedPackageArchive, RetainedPackageContext } from "./retained-package.js";
import { OfficeError } from "./errors.js";

/** Hash one borrowed archive member while reading its image metadata.
 * Sequential formats never spill. JPEG's 16-bit segment length bounds Exif
 * backtracking; TIFF alone uses caller-authorized pages for arbitrary offsets.
 * The member iterator and all scratch are retired before the result is exposed.
 */
export async function readRetainedImageMetadata(
  archive: Pick<RetainedPackageArchive, "byteLength" | "read">,
  part: string,
  mediaType: string,
  settings: RetainedPackageContext
) {
  const signal = settings.signal ?? new AbortController().signal;
  const check = () => {
    if (signal.aborted) throw new OfficeError("cancelled", "Operation cancelled.", "index");
  };
  const invalid = () => new OfficeError("invalid-archive", "Image member length changed.", "index");
  let pages: PagedStorage | undefined;
  let iterator: AsyncIterator<Uint8Array> | undefined;
  let failed = false;
  try {
    check();
    const size = await archive.byteLength(part);
    if (!Number.isSafeInteger(size) || size < 0) throw invalid();
    check();
    const seek = mediaType === "image/tiff";
    if (seek) {
      const working = settings.workingStorage;
      pages = new PagedStorage(
        { fs: working.fs, cwd: working.directory, env: {}, signal },
        (working.cacheBytes ?? 1024 * 1024) / 16384
      );
    }
    const start = pages?.allocate(size) ?? 0;
    // One complete JPEG segment plus the range codec's read-ahead window.
    const window = seek ? new Uint8Array() : new Uint8Array(65536 + 16384);
    const hash = sha1.create();
    let position = 0,
      chunk: Uint8Array = new Uint8Array(),
      cursor = 0,
      ended = false;
    iterator = archive.read(part)[Symbol.asyncIterator]();
    async function nextChunk() {
      check();
      const next = await iterator!.next();
      check();
      if (next.done) {
        ended = true;
        return;
      }
      if (!(next.value instanceof Uint8Array) || next.value.length > size - position)
        throw invalid();
      chunk = next.value;
      cursor = 0;
    }
    async function advance(end: number) {
      while (position < end) {
        check();
        if (cursor === chunk.length) {
          await nextChunk();
          if (ended) throw invalid();
          if (!chunk.length) continue;
        }
        const length = Math.min(end - position, chunk.length - cursor, 16384);
        const bytes = chunk.subarray(cursor, cursor + length);
        if (pages) await pages.write(start + position, bytes);
        else {
          const at = position % window.length,
            first = Math.min(length, window.length - at);
          window.set(bytes.subarray(0, first), at);
          window.set(bytes.subarray(first), 0);
        }
        check();
        hash.update(bytes);
        cursor += length;
        position += length;
      }
    }
    const metadata = await readImageMetadata(
      {
        size,
        async read(offset, length) {
          await advance(Math.max(position, offset + length));
          check();
          if (pages) return pages.read(start + offset, length);
          if (offset < position - window.length)
            throw new Error("Image metadata exceeded sequential lookback.");
          const bytes = new Uint8Array(length),
            at = offset % window.length;
          const first = Math.min(length, window.length - at);
          bytes.set(window.subarray(at, at + first));
          bytes.set(window.subarray(0, length - first), first);
          return bytes;
        }
      },
      mediaType,
      signal
    );
    await advance(size);
    // Complete admission and hashing even when metadata ends before the pixels.
    while (!ended) {
      await nextChunk();
      if (!ended && chunk.length) throw invalid();
    }
    check();
    return {
      ...metadata,
      sha1: Array.from(hash.digest(), (b) => b.toString(16).padStart(2, "0")).join("")
    };
  } catch (error) {
    failed = true;
    check();
    if (error instanceof OfficeError) throw error;
    throw new OfficeError("io-failure", "Image storage operation failed.", "index");
  } finally {
    const results = await Promise.allSettled([iterator?.return?.(), pages?.close()]);
    if (!failed && results.some((result) => result.status === "rejected"))
      await Promise.reject(new OfficeError("io-failure", "Image storage cleanup failed.", "index"));
  }
}
