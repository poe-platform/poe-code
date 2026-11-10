import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { compareLayerBounds } from "./compare-layers.js";
import { runConvertCli } from "./index.js";

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

// Full frames generated with native ImageMagick, with one changed center pixel.
const fullFrames = Buffer.from("R0lGODlhAwADAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAwADAAACA4R/BQAh+QQAFAAAACwAAAAAAwADAID/AAAAAP8CBIQRBwUAOw==", "base64");
for (const retained of [false, true]) {
  it.each([[[]], [["-deconstruct"]], [["-layers", "CompareAny"]]])("compares changed regions with %j (retained=" + retained + ")", async options => {
    const files = new Map([["in.gif", new Uint8Array(fullFrames)]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", fullFrames);
    expect(await runConvertCli(["in.gif", ...options, "out.gif"], retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const output = retained ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    expect(rectangles(output)).toEqual([[3, 3, 0, 0], options.length ? [1, 1, 1, 1] : [3, 3, 0, 0]]);
    expect(decodeImage(output, { animated: true }).delay).toEqual([100, 200]);
    expect(decodeImage(output, { animated: true }).data).toEqual(decodeImage(fullFrames, { animated: true }).data);
  });
}

for (const retained of [false, true]) for (const operation of [["-deconstruct"], ["-layers", "CompareAny"]]) {
  it(`compares original frames and drops unchanged frames (${operation}, retained=${retained})`, async () => {
    const files = new Map([["in.gif", new Uint8Array(fullFrames)]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", fullFrames);
    const backend = retained ? { filesystem, cwd: "/" } : files;
    expect(await runConvertCli(["in.gif", "in.gif[0]", "in.gif[0]", ...operation, "out.gif"], backend)).toMatchObject({ exitCode: 0 });
    const output = retained ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    expect(rectangles(output)).toEqual([[3, 3, 0, 0], [1, 1, 1, 1], [1, 1, 1, 1]]);
    expect(decodeImage(output, { animated: true }).delay).toEqual([100, 200, 100]);
    const playback = decodeImage(output, { animated: true }).data;
    expect(playback.slice(0, 36)).toEqual(playback.slice(72, 108));
  });
}

// Native ImageMagick fixtures: a color change at x=2, or clearing x=1.
const comparisons = [
  { name: "color", bytes: "R0lGODlhAwABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQACAAAACwAAAAAAwABAAACAoQLACH5BAANAAAALAAAAAADAAEAgP8AAAAA/wICBFIAOw==", overlay: [[1, 1, 2, 0]], clear: [] },
  { name: "clear", bytes: "R0lGODlhAwABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQACAAAACwAAAAAAwABAAACAoQLACH5BAENAAAALAAAAAADAAEAgAAAAP8AAAICDFIAOw==", overlay: [], clear: [[1, 1, 1, 0]] },
];
for (const retained of [false, true]) for (const fixture of comparisons) for (const method of ["CompareOverlay", "CompareClear"]) {
  it(`${method} selects ${fixture.name} transitions (retained=${retained})`, async () => {
    const bytes = new Uint8Array(Buffer.from(fixture.bytes, "base64"));
    const files = new Map([["in.gif", bytes]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", bytes);
    expect(await runConvertCli(["in.gif", "-layers", method, "out.gif"], retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const output = retained ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    const tiles = method === "CompareOverlay" ? fixture.overlay : fixture.clear;
    expect(rectangles(output)).toEqual([[3, 1, 0, 0], ...tiles]);
    expect(decodeImage(output, { animated: true }).loop).toBe(tiles.length ? decodeImage(bytes, { animated: true }).loop : undefined);
    expect(decodeImage(output, { animated: true }).delay).toEqual(tiles.length ? [80, 130] : [80]);
  });
}

// Native compares alpha against half opacity; Clear ignores color fuzz.
it.each([
  ["compareclear", 128, 127, 100, true],
  ["compareclear", 127, 0, 0, false],
  ["compareclear", 255, 128, 0, false],
  ["compareoverlay", 255, 127, 0, false],
  ["compareoverlay", 0, 128, 0, true],
  ["compareoverlay", 255, 255, 255, false],
] as const)("%s compares alpha %i to %i with fuzz %i", (method, before, after, fuzz, changed) => {
  const frame = { width: 1, height: 1, hasAlpha: true };
  const bounds = compareLayerBounds(frame, frame, fuzz, method);
  let next = bounds.next();
  while (!next.done) {
    next = bounds.next(next.value ? new Uint8Array(next.value.image ? [0, 0, 255, after] : [255, 0, 0, before]) : undefined);
  }
  expect(next.value).toEqual(changed ? { left: 0, top: 0, width: 1, height: 1 } : undefined);
});
