import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-31 Q16-HDRI, PNG24 inputs, -depth 8 rgba:-.
for (const mode of ["map", "sync", "retained", "command"] as const) {
  it.each([
    { value: "0", expected: [25, 100, 220, 255] },
    { value: "65535", expected: [25, 100, 220, 255] },
    { value: "65536", expected: [25, 100, 220, 255] },
    { value: "131072", expected: [25, 100, 220, 255] },
    { value: "-65536", expected: [25, 100, 220, 255] },
    { value: "257", expected: [26, 101, 221, 255] },
    { value: "-257", expected: [24, 99, 219, 255] },
    { value: "100%", expected: [25, 100, 220, 255] },
    { value: "50%", expected: [153, 228, 92, 255] },
    { value: "-50%", expected: [153, 228, 92, 255] },
    { value: "65536.5", expected: [25, 100, 220, 255] },
  ])(`${mode}: AddModulus $value wraps in Q16 units`, async ({ value, expected }) => {
      const input = await sharp(new Uint8Array([25, 100, 220]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
      const files = new Map([["/in.png", input]]), fs = createMemoryFileSystem();
      await fs.writeFile("/in.png", input);
      const args = ["/in.png", "-evaluate", "AddModulus", value, "/out.png"];
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
