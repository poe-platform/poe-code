import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
  for (const rle of [false, true]) {
    for (const top of [false, true]) {
      it(`reads TGA colors and alpha (retained=${retained}, rle=${rle}, top=${top})`, async () => {
        const colors = [[230, 10, 40, 255], [20, 190, 60, 127], [40, 70, 210, 0]];
        const expected = Uint8Array.from(Array.from({ length: 36 }, (_, i) => colors[(Math.floor(i / 12) + Number(i % 12 > 8)) % 3]!).flat());
        const header = new Uint8Array(18);
        header[0] = 3; header[2] = rle ? 10 : 2; header[12] = 12; header[14] = 3; header[16] = 32; header[17] = top ? 0x28 : 0x08;
        const pixels: number[] = [];
        for (let row = 0; row < 3; row++) {
          const y = top ? row : 2 - row;
          if (rle) {
            // A repeated nine-pixel run followed by a raw three-pixel packet.
            pixels.push(0x88);
            const [r, g, b, a] = colors[y]!;
            pixels.push(b!, g!, r!, a!, 2);
          }
          for (let x = rle ? 9 : 0; x < 12; x++) {
            const [r, g, b, a] = colors[(y + Number(x > 8)) % 3]!;
            pixels.push(b!, g!, r!, a!);
          }
        }
        const input = Uint8Array.from([...header, 65, 66, 67, ...pixels]);
        const files = new Map([["/in.tga", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.tga", input);
        const result = await runConvertCli(["/in.tga", "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        const image = decodeImage(output);
        expect(image).toMatchObject({ width: 12, height: 3 });
        expect(image.data).toEqual(expected);
      });
    }
  }
}

for (const retained of [false, true]) {
  for (const rle of [false, true]) {
    it(`reads independent grayscale TGA bytes (retained=${retained}, rle=${rle})`, async () => {
      // Bottom-origin type 3/11 fixture, independent of the image writer.
      const header = new Uint8Array(18);
      header[2] = rle ? 11 : 3; header[12] = 3; header[14] = 2; header[16] = 8;
      const pixels = [216, 69, 75, 76, 150, 29];
      const input = Uint8Array.from([...header, ...(rle ? [5, ...pixels] : pixels)]);
      const files = new Map([["/in.tga", input]]);
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.tga", input);
      const result = await runConvertCli(["/in.tga", "-depth", "8", "rgba:/out.raw"], retained ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = retained ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
      expect(output).toEqual(Uint8Array.from([76, 150, 29, 216, 69, 75].flatMap(gray => [gray, gray, gray, 255])));
    });
  }
}

for (const retained of [false, true]) {
  for (const [hex, rgba] of [
    ["000002000000000000000000030001001020007ce0031f00", "ff0000ff00ff00ff0000ffff"],
    ["00000200000000000000000003000100102100fce0831f00", "ff0000ff00ff00ff0000ff00"]
  ]) {
    it(`reads packed 16-bit TGA samples (retained=${retained}, ${hex})`, async () => {
      const input = Uint8Array.from(Buffer.from(hex!, "hex"));
      const files = new Map([["/in.tga", input]]);
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.tga", input);
      const result = await runConvertCli(["/in.tga", "-depth", "8", "rgba:/out.raw"], retained ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = retained ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
      expect(output).toEqual(Uint8Array.from(Buffer.from(rgba!, "hex")));
    });
  }
}
