import { expect, it } from "vitest";
import { encodeImage, decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const prefix of ["", "png:"])
for (const complete of [false, true])
it(`sizes and pads a ${complete ? "complete" : "partial"} final montage row via ${mode}, prefix "${prefix}"`, async () => {
  const fs = new MemoryFileSystem();
  const files = new Map<string, Uint8Array>();
  const red = [255, 0, 0, 255], lime = [0, 255, 0, 255], yellow = [255, 255, 0, 255];
  for (const [name, width, data] of [
    ["/v.png", 1, new Uint8Array([...red, ...lime])],
    ["/c.png", 3, new Uint8Array(Array.from({ length: 6 }, () => yellow).flat())]
  ] as const) {
    const { data: bytes } = encodeImage({ width, height: 2, data, format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" });
    files.set(name, bytes);
    await fs.writeFile(name, bytes);
  }
  const args = ["-geometry", "+0+0", "-tile", "2x2", `${prefix}/v.png`, `${prefix}/v.png`, `${prefix}/c.png`, ...(complete ? [`${prefix}/v.png`] : []), "/sheet.png"];
  if (mode === "command") {
    const argumentValues = createCommandArguments(["montage", ...args]);
    const context: CommandContext = {
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
    };
    expect((await createMagickCommand().execute(context)).exitCode).toBe(0);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  }
  const image = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/sheet.png") : files.get("/sheet.png")!);
  const width = complete ? 4 : 6;
  expect([image.width, image.height]).toEqual([width, 4]);
  const expected = new Uint8Array(width * 4 * 4).fill(255);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) expected.set(y === 0 ? red : lime, (y * width + x) * 4);
    for (let x = 0; x < 3; x++) expected.set(yellow, ((y + 2) * width + x) * 4);
    if (complete) expected.set(y === 0 ? red : lime, ((y + 2) * width + 3) * 4);
  }
  expect(Array.from(image.data)).toEqual(Array.from(expected));
});
