/** Original minimal CFB container, deliberately independent of product writers. */
export function originalMiniCfb(workbook: Uint8Array): Uint8Array {
  if (workbook.length > 64) throw new Error("Tiny fixture workbook exceeds one mini sector");
  const bytes = new Uint8Array(2560), view = new DataView(bytes.buffer);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  view.setUint16(26, 3, true); view.setUint16(28, 0xfffe, true); view.setUint16(30, 9, true); view.setUint16(32, 6, true);
  view.setUint32(44, 1, true); view.setUint32(48, 0, true); view.setUint32(56, 4096, true);
  view.setUint32(60, 2, true); view.setUint32(64, 1, true); view.setUint32(68, 0xfffffffe, true);
  for (let offset = 76; offset < 512; offset += 4) view.setUint32(offset, 0xffffffff, true);
  view.setUint32(76, 1, true);
  for (const begin of [1024, 1536])
    for (let offset = begin; offset < begin + 512; offset += 4) view.setUint32(offset, 0xffffffff, true);
  view.setUint32(1024, 0xfffffffe, true); view.setUint32(1028, 0xfffffffd, true);
  view.setUint32(1032, 0xfffffffe, true); view.setUint32(1036, 0xfffffffe, true); view.setUint32(1536, 0xfffffffe, true);
  for (const [id, name, type, start, size, child] of [[0, "Root Entry", 5, 3, 64, 1],
    [1, "Workbook", 2, 0, workbook.length, 0xffffffff]] as const) {
    const at = 512 + id * 128;
    for (let i = 0; i < name.length; i++) view.setUint16(at + i * 2, name.charCodeAt(i), true);
    view.setUint16(at + 64, (name.length + 1) * 2, true); bytes[at + 66] = type; bytes[at + 67] = 1;
    view.setUint32(at + 68, 0xffffffff, true); view.setUint32(at + 72, 0xffffffff, true); view.setUint32(at + 76, child, true);
    view.setUint32(at + 116, start, true); view.setUint32(at + 120, size, true);
  }
  bytes.set(workbook, 2048); return bytes;
}
