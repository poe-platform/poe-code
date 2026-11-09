import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import sharp from "./index.js";

const text = (value: string) => [...new TextEncoder().encode(value)];
const first = [33, 254, 5, ...text("first"), 0];

for (const stored of [false, true]) {
  for (const [name, extension, expected] of [
    ["separate extensions", [33, 254, 6, ...text("second"), 0], "second"],
    ["sub-blocks", [33, 254, 3, ...text("sec"), 3, ...text("ond"), 0], "second"],
    ["single extension", [], "first"],
    ["empty extension", [33, 254, 0], undefined],
    ["incomplete extension", [33, 254, 6, ...text("sec")], "first"]
  ] as const) {
    it(`reads the last complete GIF comment: ${name}, stored=${stored}`, async () => {
      const bytes = Uint8Array.from([
        71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0,
        ...first, ...extension
      ]);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/image.gif", bytes);
      const metadata = await (stored ? sharp("/image.gif", { filesystem: fs }) : sharp(bytes)).metadata();
      expect(metadata.properties?.comment).toBe(expected);
    });
  }
}
