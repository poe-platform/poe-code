import { expect, it } from "vitest";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const)
for (const format of ["png", "rgba"])
for (const geometry of ["1x1+0+0", "+0+0"])
it.each([
  { background: "#ff000000", tiles: ["xc:none"], hex: "00000000" },
  { background: "#0000ff00", tiles: ["xc:#ff000000"], hex: "00000000" },
  { background: "#0000ff01", tiles: ["xc:#ff000000"], hex: "0000ff01" },
  { background: "#0000ff00", tiles: ["xc:#ff000001"], hex: "ff000001" },
  { background: "#0000ff00", tiles: ["/tile.png"], hex: "00000000" },
  { background: "#01020300", tiles: ["null:"], hex: "01020300" },
  { background: "#01020300", tiles: ["null:", "xc:none", "null:"], hex: "010203000000000001020300" }
])(`matches transparent montage RGB via ${mode}, ${format}, ${geometry}: $background, $tiles`, async ({ background, tiles, hex }) => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  if (tiles.includes("/tile.png")) {
    const { data } = encodeImage({ width: 1, height: 1, channels: 4, hasAlpha: true, data: new Uint8Array([255, 0, 0, 0]) }, { format: "png" });
    files.set("/tile.png", data);
    await fs.writeFile("/tile.png", data);
  }
  const args = ["-geometry", geometry, "-tile", "x1", "-background", background, ...tiles, ...(format === "rgba" ? ["-depth", "8"] : []), `${format}:/sheet`];
  if (mode === "magick" || mode === "montage") {
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const stderr: unknown[] = [];
    const context: CommandContext = {
      command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() {} }, stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
    };
    expect((await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute(context)).exitCode).toBe(0);
    expect(stderr).toEqual([]);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  }
  const bytes = mode === "sync" || mode === "buffered" ? files.get("/sheet")! : await fs.readFile("/sheet");
  const image = format === "png" ? decodeImage(bytes) : undefined;
  if (image) expect([image.width, image.height]).toEqual([tiles.length, 1]);
  // Native ImageMagick clears hidden RGB only where a real tile is composited.
  expect(Buffer.from(image?.data ?? bytes).toString("hex")).toBe(hex);
});
