import { yieldTurn } from "../../../contracts/yield.js";
import { fail, type ArchiveLimits } from "../internal.js";
import { decodeZipEntry, readZipArchive, type ZipArchive } from "../zip-format.js";

/** Accept only a complete validated archive following a prefix. Never execute it. */
export async function readZipSfx(bytes: Uint8Array, limits: ArchiveLimits, signal: AbortSignal, password?: Uint8Array): Promise<ZipArchive> {
  signal.throwIfAborted();
  if (bytes.length > limits.maxArchiveBytes) fail("ZIP archive byte limit exceeded");
  let archive: ZipArchive | undefined;
  try { archive = await readZipArchive(bytes, limits, signal, { prefix: true }); }
  catch { signal.throwIfAborted(); }
  if (!archive) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let attempts = 0;
    // Unadjusted SFX offsets are relative to the embedded ZIP. Signature
    // recognition only nominates a candidate; the strict reader proves all spans.
    for (let offset = 1; offset + 22 <= bytes.length; offset++) {
      if (offset > limits.maxPatternSteps) fail("ZIP SFX scan work limit exceeded");
      if (offset % 4096 === 0) await yieldTurn(signal);
      const signature = view.getUint32(offset, true);
      if (signature !== 0x04034b50 && signature !== 0x06054b50) continue;
      if (++attempts > Math.min(64, limits.maxMembers)) fail("ZIP SFX candidate limit exceeded");
      let candidate: ZipArchive;
      try { candidate = await readZipArchive(bytes.subarray(offset), limits, signal); }
      catch { signal.throwIfAborted(); continue; }
      archive = candidate;
      break;
    }
  }
  if (!archive) fail("ZIP SFX prefix does not contain a validated archive");
  // CRC/expanded-size validation is required before prefix removal publication.
  let decoded = 0;
  for (const entry of archive.entries) {
    for await (const chunk of decodeZipEntry(entry, limits, signal, password)) {
      if (chunk.length > limits.maxTotalBytes - decoded) fail("ZIP SFX decoded byte limit exceeded");
      decoded += chunk.length;
    }
  }
  return archive;
}
