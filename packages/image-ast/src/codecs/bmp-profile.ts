/** V5 profile offsets are relative to the DIB header, after the 14-byte file header. */
export function bmpProfileRange(view: DataView, size: number): { offset: number; length: number } | undefined {
  if (view.getUint32(14, true) !== 124 || view.getUint32(70, true) !== 0x4d424544) return;
  const offset = 14 + view.getUint32(126, true), length = view.getUint32(130, true);
  if (length === 0) return;
  if (offset < 138 || offset + length > size) throw new Error("Invalid BMP embedded profile range");
  return { offset, length };
}
