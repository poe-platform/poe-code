import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {runMagickCli, runMagickCliSync} from "./index.js";

// Native ImageMagick PNG32 from RGBA 12345680abcdef40, without metadata.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVQI12MQMglrWH32vQMADboDxJrreZsAAAAASUVORK5CYII=", "base64");

for (const depth of [8, 16]) it.each(["buffered", "retained", "sync"] as const)(`writes native ${depth}-bit PGM intensities through %s conversion`, async execution => {
  const files = new Map<string, Uint8Array>([["in.png", png]]);
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/in.png", png);
  const args = ["in.png", "-depth", String(depth), "out.pgm"];
  const result = execution === "sync" ? runMagickCliSync(args, files)
    : await runMagickCli(args, execution === "retained" ? {filesystem, cwd: "/"} : files);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const output = execution === "retained" ? await filesystem.readFile("/out.pgm") : files.get("out.pgm")!;
  // magick in.png pgm:- | od -An -tx1: P5 header followed by 2f c8.
  expect(Buffer.from(output)).toEqual(Buffer.concat([Buffer.from(`P5\n2 1\n${2 ** depth - 1}\n`), Buffer.from(depth === 8 ? [0x2f, 0xc8] : [0x2f, 0x69, 0xc9, 0x02])]));
});
