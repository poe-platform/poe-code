import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {runMagickCli, runMagickCliSync} from "./index.js";

// Literal samples and magic identifiers, independent of the image decoder.
for (const sync of [false, true]) for (const [format, magic, samples] of [
  ["ppm", "P3", [4660, 4660, 4660, 52719, 52719, 52719]],
  ["pgm", "P2", [4660, 52719]],
  ["pbm", "P1", [1, 0]]
] as const) it(`selects ASCII ${format} and restores binary output, sync=${sync}`, async () => {
  const input = Buffer.concat([Buffer.from("P6\n2 1\n65535\n"), Buffer.from("123412341234cdefcdefcdef", "hex")]);
  const files = new Map<string, Uint8Array>([["in.ppm", input]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.ppm", input);
  const args = ["in.ppm", "-compress", "None", "-write", `ascii.${format}`, "-compress", "Zip", `binary.${format}`];
  const result = sync ? runMagickCliSync(args, files) : await runMagickCli(args, {filesystem: fs, cwd: "/"});
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  const ascii = Buffer.from(sync ? files.get(`ascii.${format}`)! : await fs.readFile(`/ascii.${format}`)).toString().trim().split(/\s+/);
  expect(ascii).toEqual([magic, "2", "1", ...(format === "pbm" ? [] : ["65535"]), ...samples.map(String)]);
  const binary = Buffer.from(sync ? files.get(`binary.${format}`)! : await fs.readFile(`/binary.${format}`));
  expect(binary).toEqual(Buffer.concat([Buffer.from(`${format === "ppm" ? "P6" : format === "pgm" ? "P5" : "P4"}\n2 1\n${format === "pbm" ? "" : "65535\n"}`), Buffer.from(format === "ppm" ? "123412341234cdefcdefcdef" : format === "pgm" ? "1234cdef" : "80", "hex")]));
});

for (const sync of [false, true]) for (const format of ["ppm", "pgm", "pbm"]) it(`streams 8-bit ASCII ${format} across chunks, sync=${sync}`, async () => {
  const width = 2301;
  const input = Buffer.concat([Buffer.from(`P6\n${width} 1\n255\n`), Buffer.alloc(width * 3, 51)]);
  const files = new Map<string, Uint8Array>([["in.ppm", input]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.ppm", input);
  const args = ["in.ppm", "-compress", "None", `${format}:-`];
  const result = sync ? runMagickCliSync(args, files) : await runMagickCli(args, {filesystem: fs, cwd: "/"});
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  const tokens = Buffer.from(result.stdoutBytes!).toString().trim().split(/\s+/);
  expect(tokens).toEqual([format === "ppm" ? "P3" : format === "pgm" ? "P2" : "P1", String(width), "1", ...(format === "pbm" ? [] : ["255"]), ...Array<string>(width * (format === "ppm" ? 3 : 1)).fill(format === "pbm" ? "1" : "51")]);
});
