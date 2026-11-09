import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

const indexedPngs = [
  {
    name: "duplicate",
    bytes: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEX/AAAA/wD/AAAAAP/sfQRUAAAADUlEQVR4nGNgYGRiBgAADwAHhI6ZbQAAAABJRU5ErkJggg==",
    colors: [[255, 0, 0, 255], [0, 255, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255]],
  },
  {
    name: "distinct",
    bytes: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEX/AAAA/wAAAP///wDWAo97AAAADUlEQVR4nGNgYGRiBgAADwAHhI6ZbQAAAABJRU5ErkJggg==",
    colors: [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255]],
  },
];
for (const retained of [false, true]) for (const fixture of indexedPngs) {
  for (const amounts of [[0], [1], [-1], [2], [4], [5], [-5], [1, 1], [1, -1]]) {
    it(`cycles ${fixture.name} PNG entries by source index: ${amounts} (retained=${retained})`, async () => {
      const input = Uint8Array.from(Buffer.from(fixture.bytes, "base64"));
      const files = new Map([["in.png", input]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.png", input);
      expect(await runConvertCli(["in.png", ...amounts.flatMap(amount => ["-cycle", String(amount)]), "out.png"], retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
      const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
      const shift = amounts.reduce((sum, amount) => sum + amount, 0);
      expect(Array.from(output.data)).toEqual([0, 1, 2, 3].flatMap(index => fixture.colors[((index + shift) % 4 + 4) % 4]!));
    });
  }
}

// Packed two-bit indices span several raster chunks and include duplicate red entries.
const packedPng = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAABAcAAAADAgMAAACSdI7UAAAADFBMVEX/AAAA/wD/AAAAAP/sfQRUAAAABHRSTlP/gP8AH4eGmQAAABdJREFUeJxjkB7pQIIhZ8QDho0jHWwAAE1jOnxDdRcuAAAAAElFTkSuQmCC", "base64"));
for (const retained of [false, true]) {
  it(`retains cycled indices and transparency across chunk boundaries (retained=${retained})`, async () => {
    const files = new Map([["in.png", packedPng]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", packedPng);
    expect(await runConvertCli(["in.png", "-cycle", "1", "-define", "png:preserve-colormap", "out.png"], retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
    const colors = [[255, 0, 0, 255], [0, 255, 0, 128], [255, 0, 0, 255], [0, 0, 255, 0]];
    const indices = Uint8Array.from({ length: 1031 * 3 }, (_, pixel) => (pixel % 1031 + Math.floor(pixel / 1031) + 1) % 4);
    expect(output.pngIndices).toEqual(indices);
    expect(output.data).toEqual(Uint8Array.from(Array.from(indices).flatMap(index => colors[index]!)));
  });
}

for (const amount of [1, -1]) {
  it(`cycles duplicate PNG entries through the command API by ${amount}`, async () => {
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", Uint8Array.from(Buffer.from(indexedPngs[0]!.bytes, "base64")));
    expect(await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(["in.png", "-cycle", String(amount), "out.png"]).args,
      cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
    })).toMatchObject({ exitCode: 0 });
    const output = decodeImage(await filesystem.readFile("/out.png"));
    expect(Array.from(output.data)).toEqual([0, 1, 2, 3].flatMap(index => indexedPngs[0]!.colors[(index + amount + 4) % 4]!));
  });
}
