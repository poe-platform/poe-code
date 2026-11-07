import { expect, it } from "vitest";
import { encodeImage, decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const prefix of ["", "png:"])
for (const gravity of [[], ["-gravity", "south"]])
it(`top-aligns offset-only montage inputs via ${mode}, prefix "${prefix}", gravity ${gravity}`, async () => {
  const fs = new MemoryFileSystem();
  const files = new Map<string, Uint8Array>();
  const red = [255, 0, 0, 255], lime = [0, 255, 0, 255], blue = [0, 0, 255, 255];
  for (const [name, width, height, data] of [
    ["/a.png", 2, 1, new Uint8Array([...red, ...lime])],
    ["/b.png", 1, 4, new Uint8Array([...blue, ...blue, ...blue, ...blue])]
  ] as const) {
    const { data: bytes } = encodeImage({ width, height, data, format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" });
    files.set(name, bytes);
    await fs.writeFile(name, bytes);
  }
  const args = ["-geometry", "+0+0", ...gravity, `${prefix}/a.png`, `${prefix}/b.png`, "/sheet.png"];
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
  expect([image.width, image.height]).toEqual([3, 4]);
  const expected = new Uint8Array(3 * 4 * 4).fill(255);
  expected.set([...red, ...lime]);
  for (let y = 0; y < 4; y++) expected.set(blue, (y * 3 + 2) * 4);
  expect(Array.from(image.data)).toEqual(Array.from(expected));
});
