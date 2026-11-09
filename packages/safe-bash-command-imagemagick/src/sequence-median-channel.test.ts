import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

const pixels = [
  [20, 60, 100, 255, 255, 0, 0, 55, 46, 20, 80, 160],
  [110, 10, 60, 84, 10, 220, 25, 55, 40, 23, 80, 163],
  [60, 100, 20, 215, 24, 1, 230, 55, 32, 24, 90, 160],
];
const unrestricted = [60, 100, 20, 215, 10, 220, 25, 55, 40, 23, 80, 163];

for (const mode of ["map", "retained", "command"] as const) {
  it.each([
    { channel: ["-channel", "R"], expected: [60, 0, 0, 0, 24, 0, 0, 0, 40, 0, 0, 0] },
    { channel: ["-channel", "RGB"], expected: [110, 10, 60, 0, 10, 220, 25, 0, 46, 20, 80, 0] },
    { channel: ["-channel", "GB"], expected: [0, 100, 20, 0, 0, 1, 230, 0, 0, 23, 80, 0] },
    { channel: ["-channel", "A"], expected: [0, 0, 0, 215, 0, 0, 0, 55, 0, 0, 0, 160] },
    { channel: ["-channel", "RGBA"], expected: unrestricted },
    { channel: [], expected: unrestricted },
    { channel: ["-channel", "R", "+channel"], expected: unrestricted },
  ])(`${mode}: Median ranks candidates using $channel`, async ({ channel, expected }) => {
    // ImageMagick 7.1.2-35 Q16-HDRI ranks selected channel sums, not per-channel medians.
    const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
    const paths = ["/a.png", "/b.png", "/c.png"];
    for (const [index, path] of paths.entries()) {
      const bytes = await sharp(Uint8Array.from(pixels[index]!), {
        raw: { width: 3, height: 1, channels: 4 },
      }).png().toBuffer();
      files.set(path, bytes);
      await fs.writeFile(path, bytes);
    }
    const args = [...paths, ...channel, "-evaluate-sequence", "Median", "PNG32:/out.png"];
    const result = mode === "command"
      ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
      })
      : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect([...output.data]).toEqual(expected);
  });
}
