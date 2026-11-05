import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { runConvertCli } from "./index.js";

// Native ImageMagick: 3x3 red followed by 1x1 blue at +1+1, delays 10/20.
const input = Buffer.from("R0lGODlhAwADAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAwADAAACA4R/BQAh+QQAFAAAACwBAAEAAQABAIAAAP8AAAACAkQBADs=", "base64");
function rectangles(bytes: Uint8Array) {
  const word = (at: number) => bytes[at]! | bytes[at + 1]! << 8;
  let at = 13 + (bytes[10]! & 128 ? 3 * (1 << ((bytes[10]! & 7) + 1)) : 0);
  const frames = [];
  const skip = () => { while (bytes[at]) at += bytes[at]! + 1; at++; };
  while (at < bytes.length) {
    const tag = bytes[at++];
    if (tag === 59) break;
    if (tag === 33) { at++; skip(); }
    else if (tag === 44) {
      frames.push([word(at + 4), word(at + 6), word(at), word(at + 2)]);
      const flags = bytes[at + 8]!; at += 9;
      if (flags & 128) at += 3 * (1 << ((flags & 7) + 1));
      at++; skip();
    } else throw new Error("Invalid GIF");
  }
  return frames;
}
for (const retained of [false, true]) {
  it.each([[[]], [["-coalesce"]], [["-roll", "+2+2"]]])("preserves GIF frame geometry with %j (retained=" + retained + ")", async options => {
    const files = new Map([["in.gif", new Uint8Array(input)]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.gif", input);
    const result = await runConvertCli(["in.gif", ...options, "out.gif"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = retained ? await fs.readFile("/out.gif") : files.get("out.gif")!;
    expect(rectangles(output)).toEqual([[3, 3, 0, 0], options.includes("-coalesce") ? [3, 3, 0, 0] : [1, 1, 1, 1]]);
    expect(decodeImage(output, { animated: true }).delay).toEqual([100, 200]);
    expect(decodeImage(output, { animated: true }).data).toEqual(decodeImage(input, { animated: true }).data);
  });
}

const disposalInput = Buffer.from("R0lGODlhAwADAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQECgAAACwAAAAAAwADAAACA4R/BQAh+QQJFAAAACwBAAEAAgACAIAAAAAAAP8CAgxeACH5BAweAAAALAAAAAABAAEAgACAAAAAAAICRAEAIfkEBCgAAAAsAgAAAAEAAQCA//8AAAAAAgJEAQA7", "base64");
for (const retained of [false, true]) {
  it.each([[[]], [["-coalesce"]]])("preserves transparency and disposal with %j (retained=" + retained + ")", async options => {
    const files = new Map([["in.gif", new Uint8Array(disposalInput)]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.gif", disposalInput);
    expect(await runConvertCli(["in.gif", ...options, "out.gif"], retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const output = retained ? await fs.readFile("/out.gif") : files.get("out.gif")!;
    expect(rectangles(output)).toEqual(options.length ? Array.from({ length: 4 }, () => [3, 3, 0, 0]) : [[3, 3, 0, 0], [2, 2, 1, 1], [1, 1, 0, 0], [1, 1, 2, 0]]);
    expect(decodeImage(output, { animated: true }).data).toEqual(decodeImage(disposalInput, { animated: true }).data);
    expect(decodeImage(output, { animated: true }).delay).toEqual([100, 200, 300, 400]);
  });
  it("preserves a selected frame and its offset (retained=" + retained + ")", async () => {
    const files = new Map([["in.gif", new Uint8Array(input)]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.gif", input);
    expect(await runConvertCli(["in.gif[1]", "out.gif"], retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const output = retained ? await fs.readFile("/out.gif") : files.get("out.gif")!;
    expect(rectangles(output)).toEqual([[1, 1, 1, 1]]);
    expect(decodeImage(output, { coalesce: false }).data).toEqual(new Uint8Array([0, 0, 255, 255]));
    expect(decodeImage(output).delay).toEqual([200]);
  });
}

for (const retained of [false, true]) it("reverses partial frames without expanding them (retained=" + retained + ")", async () => {
  const files = new Map([["in.gif", new Uint8Array(input)]]), fs = new MemoryFileSystem();
  await fs.writeFile("/in.gif", input);
  expect(await runConvertCli(["in.gif", "-reverse", "out.gif"], retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
  const output = retained ? await fs.readFile("/out.gif") : files.get("out.gif")!;
  expect(rectangles(output)).toEqual([[1, 1, 1, 1], [3, 3, 0, 0]]);
  expect(decodeImage(output, { animated: true }).delay).toEqual([200, 100]);
  const first = decodeImage(output).data;
  expect([...first.slice(16, 20)]).toEqual([0, 0, 255, 255]);
  // Native coalescing fills outside the opaque first update with the GIF background.
  const background = 13 + output[11]! * 3;
  expect([...output.slice(background, background + 3)]).toEqual([0, 0, 255]);
  expect(decodeImage(output, { coalesce: false })).toMatchObject({
    width: 1, height: 1, hasAlpha: false,
    backgroundColor: { r: 0, g: 0, b: 255, a: 1 }
  });
  expect(decodeImage(output, { coalesce: false, page: 1 }).data)
    .toEqual(new Uint8Array(Array.from({ length: 9 }, () => [255, 0, 0, 255]).flat()));
});
