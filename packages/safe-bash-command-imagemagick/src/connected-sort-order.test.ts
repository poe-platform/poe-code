import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
 for (const connectivity of [4, 8]) {
  for (const order of ["increasing", "decreasing", "reset", "default"] as const) {
   it(`sorts area reports with stable IDs (${mode}, ${connectivity}, ${order})`, async () => {
    const labels = Array.from({ length: 140 }, (_, i) => {
     const x = i % 14, y = Math.floor(i / 14);
     if (y === 1 && x >= 1 && x <= 5) return 1;
     if (x >= 8 && x <= 10 && y >= 1 && y <= 3) return 2;
     if (x === 2 && y >= 4 && y <= 8) return 3;
     if (x === 7 && y === 6) return 4;
     if (x === 8 && y === 7) return connectivity === 8 ? 4 : 5;
     return 0;
    });
    const pixels = Uint8Array.from(labels.flatMap(id => Array(3).fill(id ? 255 : 0)));
    const bytes = await sharp(pixels, { raw: { width: 14, height: 10, channels: 3 } }).png().toBuffer();
    const files = new Map([["input.png", bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", bytes);
    const args = ["input.png",
     ...(order === "default" ? [] : ["-define", `connected-components:sort-order=${order === "reset" ? "increasing" : order}`]),
     "-define", "connected-components:sort=area",
     ...(order === "reset" ? ["+define", "connected-components:sort-order"] : []),
     "-define", "connected-components:verbose=true", "-connected-components", String(connectivity), "out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const small = connectivity === 8 ? [4] : [4, 5];
    expect(result.stdout.trim().split("\n").slice(1).map(row => Number(row.trim().split(":")[0])))
     .toEqual(order === "decreasing" ? [0, 2, 1, 3, ...small] : [...small, 1, 3, 2, 0]);
    const image = decodeImage(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect(Array.from(image.data16!).filter((_, i) => i % 4 === 0)).toEqual(labels);
   });
  }
 }
}

for (const order of [undefined, "increasing", "decreasing"] as const) {
 it(`matches native explicit area sorting and raw labels (order=${order})`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.pgm", new TextEncoder().encode("P2\n5 4\n255\n0 0 0 0 255\n0 80 0 255 0\n0 0 80 0 0\n140 140 140 0 220\n"));
  await fs.writeFile("/out.raw", new TextEncoder().encode("KEEP"));
  const args = [
   "in.pgm", "-define", "connected-components:verbose=true",
   "-define", "connected-components:sort=area",
   ...(order ? ["-define", `connected-components:sort-order=${order}`] : []),
   "-connected-components", "4", "-depth", "16", "-endian", "MSB", "gray:out.raw"
  ];
  let stdout = "", stderr = "";
  const result = await createMagickCommand().execute({
   command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
   stdin: (async function* () {})(), signal: new AbortController().signal,
   stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
   stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
  });
  expect(result.exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(stdout.trim().split("\n").slice(1).map(row => Number(row.trim().split(":")[0])))
   .toEqual(order === "decreasing" ? [0, 4, 6, 1, 2, 3, 5, 7] : [1, 2, 3, 5, 7, 6, 4, 0]);
  expect(Buffer.from(await fs.readFile("/out.raw")).toString("hex"))
   .toBe("00000000000000000001000000020000000300040000000000050004000400060006000600040007");
 });
}
