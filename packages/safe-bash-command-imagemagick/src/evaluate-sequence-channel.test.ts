import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["map", "retained", "command"] as const) {
  for (const alpha of [false, true]) {
    for (const count of [1, 2]) {
      it.each([
        { channel: ["-channel", "R"], expected: [count === 1 ? 36 : 106, 0, 0, alpha ? 0 : 255] },
        { channel: ["-channel", "A"], expected: [0, 0, 0, alpha ? (count === 1 ? 64 : 128) : 255] },
        { channel: ["-channel", "GB"], expected: [0, count === 1 ? 104 : 90, count === 1 ? 172 : 106, alpha ? 0 : 255] },
        { channel: ["-channel", "R", "+channel"], expected: [count === 1 ? 36 : 106, count === 1 ? 104 : 90, count === 1 ? 172 : 106, alpha ? (count === 1 ? 64 : 128) : 255] },
      ])(`${mode}: Mean honors $channel (alpha=${alpha}, count=${count})`, async ({ channel, expected }) => {
        // Reference bytes verified with native ImageMagick 7.
        const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
        const paths = ["/first.png", "/second.png"].slice(0, count);
        for (const [index, path] of paths.entries()) {
          const pixel = index === 0 ? [36, 104, 172, 64] : [176, 76, 40, 191];
          const bytes = await sharp(Uint8Array.from(alpha ? pixel : pixel.slice(0, 3)), {
            raw: { width: 1, height: 1, channels: alpha ? 4 : 3 },
          }).png().toBuffer();
          files.set(path, bytes);
          await fs.writeFile(path, bytes);
        }
        const args = [...paths, ...channel, "-evaluate-sequence", "Mean", "/out.png"];
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
  }
}
