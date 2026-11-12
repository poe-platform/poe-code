import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 borders occupied cells only; zero width leaves the sheet unchanged.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { options: ["-borderwidth", "1"], rows: ["WWWWWWWWW", "WRWWGWWBW", "WWWWWWWWW", "WWWWWW...", "WYWWCW...", "WWWWWW..."] },
  { options: ["-border", "1"], rows: ["WWWWWWWWW", "WRWWGWWBW", "WWWWWWWWW", "WWWWWW...", "WYWWCW...", "WWWWWW..."] },
  { options: ["-borderwidth", "0"], rows: ["RGB", "YC."] },
  { options: [], rows: ["RGB", "YC."] },
])(`${mode}: renders montage border width $options`, async ({ options, rows }) => {
  const args = ["xc:red", "xc:lime", "xc:blue", "xc:yellow", "xc:cyan", "-bordercolor", "white", ...options,
    "-background", "black", "-tile", "3x2", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
  const fs = new MemoryFileSystem();
  let output: Uint8Array;
  if (mode === "magick" || mode === "montage") {
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout.push(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    output = Buffer.concat(stdout);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, new Map())
      : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  const image = decodeImage(output);
  expect([image.width, image.height]).toEqual([rows[0]!.length, rows.length]);
  const colors: Record<string, number[]> = {
    R: [255, 0, 0, 255], G: [0, 255, 0, 255], B: [0, 0, 255, 255],
    Y: [255, 255, 0, 255], C: [0, 255, 255, 255], W: [255, 255, 255, 255], ".": [0, 0, 0, 255]
  };
  expect(Array.from(image.data)).toEqual([...rows.join("")].flatMap(pixel => colors[pixel]!));
});

it("reports a missing borderwidth argument using the supplied option name", () => {
  expect(runMontageCliSync(["xc:red", "-borderwidth"], new Map())).toEqual({
    exitCode: 1, stdout: "", stderr: "montage: missing argument for -borderwidth\n"
  });
});
