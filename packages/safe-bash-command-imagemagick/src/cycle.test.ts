import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const opaque = Uint8Array.from(Buffer.from("R0lGODdhCQALAIEAABEhMf8AAADIAAAA3CwAAAAACQALAAAIJgABBBAwQCBBAAcHFhxocOHBhBAbSoToUKJChA4rXrxI0aDFgwEBADs=", "base64"));
const palette = [[17, 33, 49, 255], [255, 0, 0, 255], [0, 200, 0, 255], [0, 0, 220, 255]];
for (const retained of [false, true]) {
  for (const amount of [0, 1, 2, -1, 5]) {
    it(`cycles GIF palette indexes by ${amount} (retained=${retained})`, async () => {
      const files = new Map([["in.gif", opaque]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.gif", opaque);
      expect(await runConvertCli(["in.gif", "-cycle", String(amount), "out.gif"], retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
      const result = decodeImage(retained ? await filesystem.readFile("/out.gif") : files.get("out.gif")!);
      const source = decodeImage(opaque);
      const expected = source.data.slice();
      for (let offset = 0; offset < expected.length; offset += 4) {
        const index = palette.findIndex(color => color.every((value, channel) => value === source.data[offset + channel]));
        expected.set(palette[((index + amount) % 4 + 4) % 4]!, offset);
      }
      expect(result.data).toEqual(expected);
    });
  }
}

for (const retained of [false, true]) {
  it(`preserves palette order across pixel reordering and repeated cycles (retained=${retained})`, async () => {
    const files = new Map([["in.gif", opaque]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", opaque);
    const backend = retained ? { filesystem, cwd: "/" } : files;
    expect(await runConvertCli(["in.gif", "-flop", "-cycle", "1", "-cycle", "-1", "out.gif"], backend)).toMatchObject({ exitCode: 0 });
    expect(await runConvertCli(["in.gif", "-flop", "expected.gif"], backend)).toMatchObject({ exitCode: 0 });
    const output = retained ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    const expected = retained ? await filesystem.readFile("/expected.gif") : files.get("expected.gif")!;
    expect(decodeImage(output).data).toEqual(decodeImage(expected).data);
    expect(await runConvertCli(["in.gif", "-cycle", "invalid", "bad.gif"], backend)).toMatchObject({ exitCode: 1 });
  });
}

for (const retained of [false, true]) {
  it(`cycles transparency with the palette entry (retained=${retained})`, async () => {
    const input = new Uint8Array(opaque.length + 8);
    input.set(opaque.subarray(0, 25));
    input.set([33, 249, 4, 1, 0, 0, 1, 0], 25);
    input.set(opaque.subarray(25), 33);
    const files = new Map([["in.gif", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", input);
    expect(await runConvertCli(["in.gif", "-cycle", "1", "out.png"], retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
    expect(Array.from(output.data.subarray(0, 16))).toEqual([255, 0, 0, 0, 0, 200, 0, 255, 0, 0, 220, 255, 17, 33, 49, 255]);
  });
}
