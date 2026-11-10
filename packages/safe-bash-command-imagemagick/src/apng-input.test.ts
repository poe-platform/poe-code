import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { makeChunk, PNG_SIGNATURE } from "../tests/png-chunk.js";

import { runConvertCli, runConvertCliSync } from "./index.js";

async function animation(partial = false, defaultImage = false, disposal = 2) {
  const chunks: Uint8Array[] = [PNG_SIGNATURE];
  let sequence = 0;
  for (const [index, background] of ["red", "lime", "blue"].entries()) {
    const png = await sharp({ create: { width: partial && index > 0 ? 8 : 16, height: 16, channels: 4, background } }).png().toBuffer();
    if (index === 0) {
      chunks.push(png.slice(8, 33));
      const control = new Uint8Array(8), view = new DataView(control.buffer);
      view.setUint32(0, 3); view.setUint32(4, 2);
      chunks.push(makeChunk("acTL", control));
      if (defaultImage) chunks.push(png.slice(33, -12));
    }
    const control = new Uint8Array(26), view = new DataView(control.buffer);
    view.setUint32(0, sequence++); view.setUint32(4, partial && index > 0 ? 8 : 16); view.setUint32(8, 16);
    if (partial && index === 1) control[24] = disposal;
    if (partial && index === 2) view.setUint32(12, 8);
    view.setUint16(20, index === 1 ? 400 : 200); view.setUint16(22, 1000);
    chunks.push(makeChunk("fcTL", control));
    for (let pos = 8; pos < png.length;) {
      const length = new DataView(png.buffer, png.byteOffset + pos).getUint32(0);
      if (String.fromCharCode(...png.subarray(pos + 4, pos + 8)) === "IDAT") {
        const data = png.slice(pos + 8, pos + 8 + length);
        if (index === 0 && !defaultImage) chunks.push(makeChunk("IDAT", data));
        else {
          const payload = new Uint8Array(length + 4);
          new DataView(payload.buffer).setUint32(0, sequence++); payload.set(data, 4);
          chunks.push(makeChunk("fdAT", payload));
        }
      }
      pos += length + 12;
    }
  }
  chunks.push(makeChunk("IEND", new Uint8Array()));
  return Buffer.concat(chunks);
}

for (const retained of [false, true]) {
  it(`decodes explicit APNG frames and delays (retained=${retained})`, async () => {
    const bytes = await animation(), files = new Map([["input.apng", bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.apng", bytes);
    const input = retained ? { filesystem: fs, cwd: "/" } : files;
    const read = (name: string) => retained ? fs.readFile("/" + name) : files.get(name)!;
    expect(await runConvertCli(["APNG:input.apng", "out.gif"], input)).toMatchObject({ exitCode: 0, stderr: "" });
    const gif = await read("out.gif");
    expect(await sharp(gif, { animated: true }).metadata()).toMatchObject({ pages: 3, delay: [200, 400, 200], loop: 2 });
    for (const [page, color] of [[255, 0, 0], [0, 255, 0], [0, 0, 255]].entries()) {
      expect([...decodeImage(gif, { page }).data.slice(0, 3)]).toEqual(color);
    }
    expect(await runConvertCli(["APNG:input.apng", "-append", "strip.png"], input)).toMatchObject({ exitCode: 0 });
    const strip = decodeImage(await read("strip.png"));
    expect(strip).toMatchObject({ width: 16, height: 48 });
    for (const [index, color] of [[255, 0, 0], [0, 255, 0], [0, 0, 255]].entries()) expect([...strip.data.slice(index * 16 * 16 * 4, index * 16 * 16 * 4 + 3)]).toEqual(color);
    expect(await runConvertCli(["input.apng", "plain.gif"], input)).toMatchObject({ exitCode: 0 });
    expect((await sharp(await read("plain.gif")).metadata()).pages ?? 1).toBe(1);
  });
}

for (const retained of [false, true]) for (const disposal of [1, 2]) {
  it(`composes partial frames, restores previous canvas and skips the default image (retained=${retained}, disposal=${disposal})`, async () => {
    const bytes = await animation(true, true, disposal), files = new Map<string, Uint8Array>([["input.png", bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", bytes);
    const result = await runConvertCli(["apng:input.png[2]", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const image = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect(image).toMatchObject({ width: 16, height: 16 });
    expect([...image.data.slice(0, 4)]).toEqual(disposal === 2 ? [255, 0, 0, 255] : [0, 0, 0, 0]);
    expect([...image.data.slice(8 * 4, 8 * 4 + 4)]).toEqual([0, 0, 255, 255]);
  });
}
it("supports synchronous APNG stdin and rejects truncated animations", async () => {
  const bytes = await animation(), files = new Map<string, Uint8Array>();
  expect(runConvertCliSync(["APNG:-", "-append", "out.png"], files, bytes)).toMatchObject({ exitCode: 0 });
  expect(decodeImage(files.get("out.png")!)).toMatchObject({ height: 48 });
  expect(runConvertCliSync(["APNG:-", "bad.gif"], files, bytes.subarray(0, -20))).toMatchObject({ exitCode: 1 });
  expect(files.has("bad.gif")).toBe(false);
});
