// Psiconv 0.9.9 parse_image.c; GPL-2.0-or-later.
import { SsconvertError } from "../contracts.js";
export interface PsionSketchCursor { u8(): number; u16(): number; u32(): number; }

export function parsePsionSketchFile(cursor: (offset: number) => PsionSketchCursor & { text(): string }, work: () => void): void {
  const table = cursor(cursor(0).u32()), count = table.u8() >> 1;
  let appOffset = 0, imageOffset = 0;
  for (let i = 0; i < count; i++) {
    const id = table.u32(), offset = table.u32();
    if (id === 0x10000089) appOffset = offset;
    else if (id === 0x1000007d) imageOffset = offset;
  }
  if (!appOffset) throw new SsconvertError("io", "Error while parsing Psion file.");
  const app = cursor(appOffset);
  if (app.u32() !== 0x1000007d || app.text().toLowerCase() !== "paint.app")
    throw new SsconvertError("io", "Error while parsing Psion file.");
  if (imageOffset) parsePsionSketch(cursor, imageOffset, work);
}

/** psiconv parses images in page objects; Gnumeric discards their pixels. */
export function parsePsionSketch(cursor: (offset: number) => PsionSketchCursor, section: number, work: () => void): void {
  const c = cursor(section), paintStart = section + 18;
  const invalid = (): never => { throw new SsconvertError("io", "Error while parsing Psion file."); };
  for (let i = 0; i < 9; i++) c.u16();
  const size = c.u32(), offset = c.u32(), width = c.u32(), height = c.u32();
  c.u32(); c.u32(); const bits = c.u32(), color = c.u32(); c.u32();
  let compression = c.u32();
  if (size < offset) invalid();
  if (compression > 4) compression = 0; // Released fallback despite its warning saying RLE.
  let encoded = size - offset, decoded = 0;
  // Released psiconv logs an error for non-40 offsets but overwrites its status
  // with the next successful header read and then follows the declared offset.
  const pixels = cursor(paintStart + offset);
  const byte = () => { if (encoded <= 0) invalid(); encoded--; return pixels.u8(); };
  const emit = (count: number) => {
    for (let i = 0; i < count; i++) { work(); decoded++; }
  };
  while (encoded) {
    if (compression === 0) { byte(); emit(1); }
    else if (compression === 2) {
      byte(); const high = byte(); emit((high >> 4) + 1);
    } else {
      const marker = byte(), unit = compression === 1 ? 1 : compression === 3 ? 2 : 3;
      const count = marker < 128 ? marker + 1 : 256 - marker;
      for (let i = 0; i < (marker < 128 ? 1 : count) * unit; i++) byte();
      // Native RLE12/16/24 stores each word/triplet in a list of u8 entries;
      // on the captured little-endian ABI only its low byte survives.
      emit(count);
    }
  }
  const row = Math.ceil(width * bits / 8), required = height ? Math.ceil(row / 4) * 4 * (height - 1) + row : 0;
  if (!Number.isSafeInteger(required)) throw new SsconvertError("resource-limit", "ssconvert Psion Sketch dimensions limit exceeded");
  if (required > decoded) invalid();
  // Native decode and byte-to-pixel failures precede float conversion.
  // Color depths through 47 have defined channel shifts in parse_image.c:
  // ceil(bits/3) red/green bits and the remainder blue bits. At 48 the
  // unsigned pixel's red-channel shift reaches 32. Unknown nonzero color
  // markers use the source color fallback. Gnumeric discards all pixels.
  if (bits > 32 && (!color || bits > 47))
    throw new SsconvertError("unsupported-feature", "ssconvert Psion Sketch bit depth is not qualified");
  // Pixel conversion cannot fail on admitted bytes. Account for each ignored
  // native pixel without allocating image buffers or relying on host memory.
  for (let y = 0; y < height; y++) {
    work(); for (let x = 0; x < width; x++) work();
  }
  const trailer = cursor(paintStart + size);
  trailer.u16(); trailer.u16(); for (let i = 0; i < 4; i++) trailer.u32();
}
