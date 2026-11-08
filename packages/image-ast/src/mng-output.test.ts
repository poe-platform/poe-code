import { expect, it } from "vitest";
import sharp from "./index.js";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";

it("supports explicit MNG output and infers MNG file destinations", async () => {
  const fs = new MemoryFileSystem();
  const input = sharp(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]), { raw: { width: 1, height: 2, channels: 4 } }).gif({ pageHeight: 1, delay: [200, 400], loop: 2 }).toBufferSync();
  const explicit = sharp(input, { animated: true }).toFormat("mng").toBufferSync();
  expect([...explicit.slice(0, 8)]).toEqual([138, 77, 78, 71, 13, 10, 26, 10]);
  await fs.writeFile("/input.gif", input);
  const info = await sharp("/input.gif", { filesystem: fs, animated: true }).toFile("/out.mng");
  const bytes = await fs.readFile("/out.mng");
  expect(info.format).toBe("mng");
  expect([...bytes.slice(0, 8)]).toEqual([...explicit.slice(0, 8)]);
  expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(32)).toBe(2);
});
