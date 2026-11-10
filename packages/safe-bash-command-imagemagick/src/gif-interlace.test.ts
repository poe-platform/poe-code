import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");
const source = Buffer.from("R0lGODlhCQALAIEAABEhMf8AAADIAAAA3CH/C05FVFNDQVBFMi4wAwEEAAAh/gtzb3VyY2Ugbm90ZQAh+QQFBwAAACwAAAAACQALAAAIJgABBBAwQCBBAAcHFhxocOHBhBAbSoToUKJChA4rXrxI0aDFgwEBACH5BAkTAAAALAAAAAAJAAsAgREhMf8AAADIAAAA3AgmAAMIGABAIMEABwcWHGhw4cGEEBtKhOhQokKEDitevEjRoMWDAQEAOw==", "base64");
function frames(bytes: Uint8Array) {
  let at = 13 + (bytes[10]! & 128 ? 3 * (1 << ((bytes[10]! & 7) + 1)) : 0);
  const descriptors: number[] = [], disposals: number[] = [];
  while (bytes[at] !== 59) {
    const tag = bytes[at++];
    if (tag === 33) {
      if (bytes[at] === 249) disposals.push((bytes[at + 2]! >> 2) & 7);
      at++;
    } else {
      expect(tag).toBe(44);
      const packed = bytes[at + 8]!;
      descriptors.push(packed & 64);
      at += 9 + (packed & 128 ? 3 * (1 << ((packed & 7) + 1)) : 0);
      at++;
    }
    while (bytes[at]) at += bytes[at]! + 1;
    at++;
  }
  return { descriptors, disposals };
}
for (const retained of [false, true]) {
  it(`preserves GIF animation while writing four-pass interlace (retained=${retained})`, async () => {
    const files = new Map<string, Uint8Array>([["/in.gif", source]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.gif", source);
    const result = await runConvertCli(["/in.gif", "-write", "/default.gif", "-interlace", "GIF", "-write", "/interlaced.gif", "-interlace", "None", "-write", "/reset.gif", "-interlace", "gif", "/final.gif"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const pixels = await sharp(source, { animated: true }).ensureAlpha().raw().toBuffer();
    for (const name of ["default", "interlaced", "reset", "final"]) {
      const bytes = retained ? await fs.readFile(`/${name}.gif`) : files.get(`/${name}.gif`)!;
      const bit = name === "interlaced" || name === "final" ? 64 : 0;
      expect(frames(bytes)).toEqual({ descriptors: [bit, bit], disposals: [1, 2] });
      expect(await sharp(bytes, { animated: true }).ensureAlpha().raw().toBuffer()).toEqual(pixels);
      expect(await sharp(bytes, { animated: true }).metadata()).toMatchObject({ width: 9, pageHeight: 11, pages: 2, delay: [70, 190], loop: 5 });
    }
  });
}
