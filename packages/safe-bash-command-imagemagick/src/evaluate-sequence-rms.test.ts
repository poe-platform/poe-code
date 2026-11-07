import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-31 Q16-HDRI, PNG24 inputs, -depth 8 rgba:-.
for (const mode of ["map", "sync", "retained", "command"] as const) {
  for (const operation of ["RootMeanSquare", "RMS"]) {
    it.each([
      { count: 1, alpha: false, expected: [0, 1, 1, 255] },
      { count: 3, alpha: false, expected: [108, 52, 30, 255] },
      { count: 1, alpha: true, expected: [0, 1, 1, 0] },
      { count: 3, alpha: true, expected: [108, 52, 30, 133] },
    ])(`${mode}: ${operation} with $count inputs, alpha=$alpha matches native`, async ({ count, alpha, expected }) => {
      const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
      const paths: string[] = [];
      for (const pixel of [[36, 104, 172], [176, 76, 40], [64, 48, 32]].slice(0, count)) {
        const path = `/input${paths.length}.png`;
        const bytes = await sharp(new Uint8Array(alpha ? [...pixel, (paths.length + 1) * 64] : pixel), { raw: { width: 1, height: 1, channels: alpha ? 4 : 3 } }).png().toBuffer();
        files.set(path, bytes);
        await fs.writeFile(path, bytes);
        paths.push(path);
      }
      const args = [...paths, "-evaluate-sequence", operation, "/out.png"];
      const result = mode === "command"
        ? await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} },
        })
        : mode === "sync" ? runConvertCliSync(args, files)
        : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0 });
      const output = decodeImage(mode === "map" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
      expect([...output.data]).toEqual(expected);
    });
  }
}
