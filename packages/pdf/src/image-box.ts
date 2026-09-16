import type {ImageBlock, PageBox} from "./model.js";

export function imageBox(block: ImageBlock, page: PageBox, fail: (message: string) => never, work: () => void): {width: number; height: number; pixels: number} {
  const bytes = block.bytes; const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0; let height = 0;
  if (block.media === "png") {
    if (bytes.length < 24 || ![137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b) || view.getUint32(12) !== 0x49484452) fail("Invalid PNG");
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (block.media === "jpeg") {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) fail("Invalid JPEG");
    let cursor = 2;
    while (cursor + 4 <= bytes.length) {
      work(); if (bytes[cursor++] !== 255) fail("Invalid JPEG marker");
      while (bytes[cursor] === 255) {cursor++; work();}
      const marker = bytes[cursor++]!;
      if (marker === 217 || marker === 218 || cursor + 2 > bytes.length) break;
      const length = view.getUint16(cursor); if (length < 2 || cursor + length > bytes.length) fail("Invalid JPEG segment");
      if ([192,193,194].includes(marker)) {
        if (length < 8) fail("Invalid JPEG frame"); height = view.getUint16(cursor + 3); width = view.getUint16(cursor + 5); break;
      }
      cursor += length;
    }
  } else fail("Unsupported image format");
  if (!width || !height) fail("Missing image dimensions");
  const pixels = width * height;
  if (block.fit !== undefined && block.fit !== "contain" && block.fit !== "natural") fail("Invalid image fit rule");
  if (![block.width, block.height].every(n => Number.isFinite(n) && n > 0)) fail("Invalid image box");
  if (block.fit === "natural") {
    if (width > block.width || height > block.height || width > page.width - 2 * page.margin || height > page.height - 2 * page.margin) fail("Natural image exceeds box");
  } else {
    const scale = Math.min(block.width / width, block.height / height, (page.width - 2 * page.margin) / width, (page.height - 2 * page.margin) / height);
    width *= scale; height *= scale;
  }
  return {width, height, pixels};
}
