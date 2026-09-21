// Original in-memory Psion Sheet structures; no native writer or imported sample.
export function psionFixture(cellRecords: readonly number[] = [0, 0, 0, 32, 7, 0, 0, 0], cellCount = 1): Uint8Array {
  const bytes = new Uint8Array(400), v = new DataView(bytes.buffer);
  const u32 = (at: number, n: number) => v.setUint32(at, n, true);
  const put = (at: number, data: readonly number[]) => bytes.set(data, at);
  u32(0, 0x10000037); u32(4, 0x1000006d); u32(8, 0x10000088); u32(12, 0x550815a8);
  u32(16, 20); bytes[20] = 8;
  for (const [i, id, offset] of [[0, 0x1000011d, 64], [1, 0x1000011f, 280], [2, 0x10000089, 310], [3, 0x10000105, 340]]) {
    u32(21 + i! * 8, id!); u32(25 + i! * 8, offset!);
  }
  bytes[64] = 2; u32(65, 90); u32(69, 94); u32(73, 100); u32(77, 96);
  put(90, [2, 0, 3]); put(94, [2, 0]); put(96, [2, 0]);
  put(100, [2, 2, 0]); u32(103, 120);
  put(120, [4, 1, 2, 0]); u32(124, 150); u32(128, 152); u32(132, 160); u32(136, 220); u32(140, 156);
  put(150, [2, 0]); put(152, [2, 0]); put(160, [2, 0, cellCount << 1, ...cellRecords]);
  put(220, [15, 0, 144, 0]); u32(240, 300); bytes[244] = 0; u32(245, 1200); put(249, [0, 0, 0, 255, 255, 255]);
  put(280, [2]); u32(281, 0); u32(285, 0); put(289, [0, 0, 0, 0]);
  u32(310, 0x10000088); put(314, [38, ...Array.from("Sheet.app", c => c.charCodeAt(0))]);
  u32(340, 1); u32(380, 0x100000fd); u32(384, 11906); u32(388, 16838);
  return bytes;
}
