import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
  for (const page of [undefined, "10x12+2+3", "10x12-2-3"]) {
    it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])(`auto-orients EXIF %s pixels and page ${page} (${mode})`, async orientation => {
      const image = sharp(Uint8Array.from([10, 50, 100, 150, 200, 245].flatMap(value => [value, value, value])),
        { raw: { width: 3, height: 2, channels: 3 } });
      const input = await (orientation ? image.withMetadata({ orientation }) : image).jpeg({ quality: 100 }).toBuffer();
      const options = [...(page ? ["-repage", page] : []), "-auto-orient"];
      const native = spawnSync("magick", ["jpeg:-", ...options, "png:-"], { input });
      expect(native.status, native.stderr.toString()).toBe(0);
      const expected = decodeImage(native.stdout);
      const fs = new MemoryFileSystem(), files = new Map([["/input.jpg", input]]);
      await fs.writeFile("/input.jpg", input);
      const args = ["/input.jpg", ...options, "/output.png"];
      const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
        args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} } })
        : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0 });
      const output = decodeImage(mode === "buffered" ? files.get("/output.png")! : await fs.readFile("/output.png"));
      expect(output).toMatchObject({ width: expected.width, height: expected.height, data: expected.data });
      expect(output.orientation).toBe(expected.orientation);
      expect(output.virtualCanvas).toEqual(expected.virtualCanvas);
    });
  }
}
