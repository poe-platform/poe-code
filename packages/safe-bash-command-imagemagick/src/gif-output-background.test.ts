import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
  for (const split of [false, true]) {
    it.each([undefined, "#141414", "#323232"])(`writes the selected GIF screen background ${mode}, split=${split} (%s)`, async background => {
      const pixels = Uint8Array.from([10, 20, 30, 40, 50, 60].flatMap(v => [v, v, v, 255]));
      const input = await sharp(pixels, { raw: { width: 3, height: 2, channels: 4 } }).gif().toBuffer();
      const paletteSize = 1 << ((input[10]! & 7) + 1);
      input[11] = Array.from({ length: paletteSize }, (_, i) => i).find(i => input[13 + i * 3] === 40)!;
      const files = new Map([["/in.gif", input]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.gif", input);
      const copy = split ? "/copy-%d.gif" : "/copy.gif", out = split ? "/out-%d.gif" : "/out.gif";
      const args = ["/in.gif", "-repage", "12x9+4+3", ...(background ? ["-background", background] : []), "-write", copy, out];
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write() {} },
      }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result.exitCode).toBe(0);
      for (const path of [split ? "/copy-0.gif" : copy, split ? "/out-0.gif" : out]) {
        const output = (mode === "retained" || mode === "command") ? await filesystem.readFile(path) : files.get(path)!;
        const index = output[11]!;
        expect(Array.from(output.slice(13 + index * 3, 16 + index * 3))).toEqual(Array(3).fill(background === "#141414" ? 20 : background === "#323232" ? 50 : 40));
        const image = decodeImage(output, { coalesce: false });
        expect(image.data).toEqual(pixels);
        expect(image.virtualCanvas).toEqual({ width: 12, height: 9, x: 4, y: 3 });
      }
    });
}
}
