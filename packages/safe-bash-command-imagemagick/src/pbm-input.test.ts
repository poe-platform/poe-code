import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

const fixtures = [
  { raster: "0110", expected: "ffffff000000000000ffffff" },
  { raster: "0 1 1 0", expected: "ffffff000000000000ffffff" },
  { raster: "01 # middle of raster\n10", expected: "ffffff000000000000ffffff" },
  { raster: "0 2 0 3", expected: "ffffff000000ffffff000000" }
];

for (const sync of [false, true]) it.each(fixtures)(`reads one P1 pixel per digit: $raster, sync=${sync}`, async ({ raster, expected }) => {
  const input = Buffer.from(`P1\n4 1\n${raster}\n`);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.pbm", input);
  await fs.writeFile("/out.ppm", Buffer.from("keep"));
  const files = new Map<string, Uint8Array>([["input.pbm", input], ["out.ppm", Buffer.from("keep")]]);
  const args = createCommandArguments(["input.pbm", "out.ppm"]);
  let stderr = "";
  const result = sync ? runMagickCliSync(args.args, files) : await createMagickCommand().execute({
    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect("stderr" in result ? result.stderr : stderr).toBe("");
  expect(result.exitCode).toBe(0);
  const output = sync ? files.get("out.ppm")! : await fs.readFile("/out.ppm");
  // Check the actual file's RGB bytes without using the image decoder.
  expect(Buffer.from(output)).toEqual(Buffer.concat([Buffer.from("P6\n4 1\n255\n"), Buffer.from(expected, "hex")]));
});
