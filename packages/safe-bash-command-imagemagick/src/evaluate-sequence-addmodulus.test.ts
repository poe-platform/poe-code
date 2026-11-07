import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, PNG24 inputs, -depth 8 rgba:-.
for (const mode of ["map", "sync", "retained", "command"] as const) {
  for (const { operation, combined } of [
    { operation: "AddModulus", combined: [58, 20, 218, 255] },
    { operation: "Mean", combined: [104, 92, 158, 255] },
  ]) {
    it.each([
      { count: 1, reverse: false, expected: [36, 108, 201, 255] },
      { count: 3, reverse: false, expected: combined },
      { count: 3, reverse: true, expected: combined },
    ])(`${mode}: ${operation} with $count inputs (reverse=$reverse) matches native`, async ({ count, reverse, expected }) => {
      const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
      const paths: string[] = [];
      for (const pixel of [[36, 108, 201], [83, 17, 223], [194, 150, 49]].slice(0, count)) {
        const path = `/input${paths.length}.png`;
        const bytes = await sharp(new Uint8Array(pixel), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
        files.set(path, bytes);
        await fs.writeFile(path, bytes);
        paths.push(path);
      }
      if (reverse) paths.reverse();
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
