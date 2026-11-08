import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {createCommandArguments} from "safe-bash-contracts/command";
import {createMagickCommand, runMagickCliSync} from "./index.js";

// Native ImageMagick P7 headers and rasters for the two RGB pixels below.
const fixtures = [
  {format: "ppm", header: "P6\n2 1\n255\n", raster: "123456abcdef"},
  {format: "pgm", header: "P5\n2 1\n255\n", raster: "2fc8"},
  {format: "pbm", header: "P4\n2 1\n", raster: "80"},
  {format: "pam", header: "P7\nWIDTH 2\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n", raster: "12345680abcdef00"},
];

for (const sync of [false, true]) it.each(fixtures)(`writes $format comment headers with unchanged rasters, sync=${sync}`, async ({format, header, raster}) => {
  const input = Buffer.concat([Buffer.from("P7\nWIDTH 2\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), Buffer.from("12345680abcdef00", "hex")]);
  const args = createCommandArguments(["input.pam", "-set", "comment", "caption A\ncaption B", `out.${format}`]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.pam", input);
  const files = new Map<string, Uint8Array>([["input.pam", input]]);
  let stderr = "";
  const result = sync ? runMagickCliSync(args.args, files) : await createMagickCommand().execute({command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: {async write() {}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}});
  expect(stderr).toBe("");
  expect(result.exitCode).toBe(0);
  const output = sync ? files.get(`out.${format}`)! : await fs.readFile(`/out.${format}`);
  expect(Buffer.from(output)).toEqual(Buffer.concat([Buffer.from(header.slice(0, 3) + "#caption A\n#caption B\n" + header.slice(3)), Buffer.from(raster, "hex")]));
});
