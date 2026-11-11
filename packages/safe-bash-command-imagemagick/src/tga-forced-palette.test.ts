import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: gray50 uses a BGR palette only with -type Palette.
for (const mode of ["sync", "map", "filesystem", "command"]) for (const output of ["stdout", "write", "scene", "write-scene"]) {
  for (const rle of [false, true]) for (const palette of [false, true]) {
    it(`writes grayscale TGA with explicit palette selection (${mode}, ${output}, rle=${rle}, palette=${palette})`, async () => {
      const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
      const target = output.includes("scene") ? "/out-%d.tga" : "/out.tga";
      const destination = output.startsWith("write") ? ["-write", target, "-type", "Grayscale", "null:"]
        : [output === "stdout" ? "tga:-" : target];
      const args = ["xc:gray50", ...(palette ? ["-type", "Palette"] : []), ...(rle ? ["-compress", "RLE"] : []), ...destination];
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout.push(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "map" ? files : { filesystem, cwd: "/" });
      expect(result.exitCode).toBe(0);
      expect("stderr" in result ? result.stderr : stderr).toBe("");
      const path = output.includes("scene") ? "/out-0.tga" : "/out.tga";
      const bytes = output === "stdout" ? ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout))
        : mode === "filesystem" || mode === "command" ? await filesystem.readFile(path) : files.get(path)!;
      expect([...bytes.subarray(0, 18)]).toEqual([
        0, palette ? 1 : 0, (palette ? 1 : 3) + (rle ? 8 : 0), 0, 0,
        palette ? 1 : 0, 0, palette ? 24 : 0, 0, 0, 0, 0, 1, 0, 1, 0, 8, 32
      ]);
      expect([...bytes.subarray(18)]).toEqual([
        ...(palette ? [127, 127, 127] : []), ...(rle ? [0] : []), palette ? 0 : 127
      ]);
      expect([...decodeImage(bytes).data]).toEqual([127, 127, 127, 255]);
    });
  }
}
