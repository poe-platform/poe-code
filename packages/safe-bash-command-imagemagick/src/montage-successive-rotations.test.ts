import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

const colors: Record<string, number[]> = {
  R: [255, 0, 0, 255], G: [0, 255, 0, 255], B: [0, 0, 255, 255], Y: [255, 255, 0, 255],
  K: [0, 0, 0, 255], W: [255, 255, 255, 255], C: [0, 255, 255, 255], M: [255, 0, 255, 255]
};

for (const mode of ["sync", "buffered", "retained", "command"] as const)
it.each([
  { angles: [], pixels: "RGKWBYCM" },
  { angles: [90], pixels: "BRCKYGMW" },
  { angles: [90, 270], pixels: "RGKWBYCM" },
  { angles: [90, 90], pixels: "YBMCGRWK" },
  { angles: [90, -90], pixels: "RGKWBYCM" },
  { angles: [90, 0], pixels: "BRCKYGMW" },
  { angles: [90, 90, 90, 90], pixels: "RGKWBYCM" }
])(`composes successive montage rotations via ${mode}: $angles`, async ({ angles, pixels }) => {
  const files = new Map<string, Uint8Array>();
  const fs = new MemoryFileSystem();
  for (const [name, rgb] of [["a", "ff000000ff000000ffffff00"], ["b", "000000ffffff00ffffff00ff"]]) {
    const bytes = Buffer.concat([Buffer.from("P6\n2 2\n255\n"), Buffer.from(rgb!, "hex")]);
    files.set(`${name}.ppm`, bytes);
    await fs.writeFile(`/${name}.ppm`, bytes);
  }
  const args = ["-geometry", "+0+0", "-tile", "2x1", ...files.keys(),
    ...angles.flatMap(angle => ["-rotate", String(angle)]), "ppm:-"];
  let output: Uint8Array;
  if (mode === "command") {
    const argumentValues = createCommandArguments(["montage", ...args.slice(0, -1), "sheet.ppm"]);
    const stderr: unknown[] = [];
    const context: CommandContext = {
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() {} }, stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
    };
    expect((await createMagickCommand().execute(context)).exitCode).toBe(0);
    expect(stderr).toEqual([]);
    output = await fs.readFile("/sheet.ppm");
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  const actual = decodeImage(output);
  expect([actual.width, actual.height]).toEqual([4, 2]);
  expect(actual.data).toEqual(Uint8Array.from([...pixels].flatMap(pixel => colors[pixel]!)));
});
