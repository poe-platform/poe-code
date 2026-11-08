import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import sharp, {decodeImage} from "./index.js";

it("retains header comments in memory and file metadata without consuming hash-valued pixels", async () => {
  const bytes = Buffer.concat([Buffer.from("P6\n#first\n1 #second\n1\n255 #last\n"), Buffer.from([35, 10, 13])]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.ppm", bytes);
  const properties = {comment: "first\nsecond\nlast\n"};
  expect(decodeImage(bytes).properties).toEqual(properties);
  expect(Array.from(decodeImage(bytes).data)).toEqual([35, 10, 13, 255]);
  expect((await sharp(bytes).metadata()).properties).toEqual(properties);
  expect((await sharp("/in.ppm", {filesystem: fs}).metadata()).properties).toEqual(properties);
  expect(Array.from(await sharp("/in.ppm", {filesystem: fs}).raw().toBuffer())).toEqual([35, 10, 13]);
});

it("does not invent a comment property from the binary raster", () => {
  const bytes = Buffer.concat([Buffer.from("P6\n1 1\n255\n"), Buffer.from([35, 10, 13])]);
  expect(decodeImage(bytes).properties).toBeUndefined();
  expect(Array.from(decodeImage(bytes).data)).toEqual([35, 10, 13, 255]);
});
