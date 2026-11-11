/** V5 profile offsets are relative to the DIB header. */
export function bmpProfileRange(view: DataView, size: number): { offset: number; length: number } | undefined {
  const fileHeader = view.getUint8(0) === 66 && view.getUint8(1) === 77 ? 14 : 0;
  if (view.getUint32(fileHeader, true) !== 124 || view.getUint32(fileHeader + 56, true) !== 0x4d424544) return;
  const offset = fileHeader + view.getUint32(fileHeader + 112, true), length = view.getUint32(fileHeader + 116, true);
  if (length === 0) return;
  if (offset < fileHeader + 124 || offset + length > size) throw new Error("Invalid BMP embedded profile range");
  return { offset, length };
}
