import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "map", "filesystem", "magick", "montage"]) {
  for (const format of ["tga", "icb", "vda", "vst", "ICB", "VDA", "VST"]) {
    for (const target of [`${format}:-`, `${format}:/sheet.bin`, `/sheet.${format}`]) {
      it(`writes TGA montage through ${mode} to ${target}`, async () => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["xc:red", "xc:lime", "xc:blue", "xc:white", "-tile", "2x2", "-geometry", "+0+0", target];
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "magick" || mode === "montage"
          ? await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute({
            command: mode, args: createCommandArguments([...(mode === "magick" ? ["montage"] : []), ...args]).args,
            cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout.push(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
          })
          : mode === "sync" ? runMontageCliSync(args, files)
            : await runMontageCli(args, mode === "map" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const path = target.includes(":") ? target.slice(target.indexOf(":") + 1) : target;
        const bytes = path === "-"
          ? "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout)
          : mode === "sync" || mode === "map" ? files.get(path)! : await filesystem.readFile(path);
        // Native ImageMagick 7.1.2-35: truecolor, top-left origin, 24-bit BGR.
        expect([...bytes.subarray(0, 18)]).toEqual([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 24, 32]);
        expect([...bytes.subarray(18)]).toEqual([0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255]);
        expect([...decodeImage(bytes).data]).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
        if (path === "-") {
          expect(files.size).toBe(0);
          expect(await filesystem.readdir("/")).toEqual([]);
        }
      });
    }
  }
}
