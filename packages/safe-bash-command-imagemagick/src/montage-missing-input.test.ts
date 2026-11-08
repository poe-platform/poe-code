import { expect, it } from "vitest";
import { encodeImage, decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const)
for (const inputs of [["a.png", "absent.png"], ["a.png", "absent.png", "b.png"], ["absent.png", "a.png"], ["absent.png"]])
it(`preserves readable montage tiles and missing-input errors via ${mode}: ${inputs.join(" ")}`, async () => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const red = [255, 0, 0, 255], lime = [0, 255, 0, 255], blue = [0, 0, 255, 255];
  for (const [name, width, height, pixels] of [
    ["a.png", 2, 1, [...red, ...lime]],
    ["b.png", 1, 4, Array.from({ length: 4 }, () => blue).flat()]
  ] as const) {
    const { data } = encodeImage({ width, height, data: new Uint8Array(pixels), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" });
    files.set(name, data);
    await fs.writeFile("/" + name, data);
  }
  const args = ["-geometry", "+0+0", ...inputs, "png:-"];
  let bytes: Uint8Array | undefined, stderr = "", exitCode: number;
  if (mode === "magick" || mode === "montage") {
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const chunks: Uint8Array[] = [];
    const context: CommandContext = {
      command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { chunks.push(new Uint8Array(chunk)); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }, registerCleanup() {}
    };
    exitCode = (await command.execute(context)).exitCode;
    bytes = new Uint8Array(chunks.flatMap(chunk => Array.from(chunk)));
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    ({ exitCode, stderr, stdoutBytes: bytes } = result);
  }
  expect(exitCode).toBe(1);
  expect(stderr).toContain("unable to open image 'absent.png'");
  if (inputs.length === 1) {
    expect(bytes?.length ?? 0).toBe(0);
    return;
  }
  expect(bytes?.length).toBeGreaterThan(0);
  const image = decodeImage(bytes!);
  const hasBlue = inputs.includes("b.png"), width = hasBlue ? 3 : 2, height = hasBlue ? 4 : 1;
  expect([image.width, image.height]).toEqual([width, height]);
  const expected = new Uint8Array(width * height * 4).fill(255);
  expected.set([...red, ...lime]);
  if (hasBlue) for (let y = 0; y < height; y++) expected.set(blue, (y * width + 2) * 4);
  expect(Array.from(image.data)).toEqual(Array.from(expected));
});
