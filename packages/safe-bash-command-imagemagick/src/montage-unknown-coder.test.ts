import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "sync", "buffered", "retained"] as const) {
  it.each(["bmp4", "unknownlab", "bmp"])(`${mode}: validates %s output for generated tiles`, async coder => {
    const args = ["xc:red", "xc:blue", "-tile", "2x1", "-geometry", "+0+0", `${coder}:-`];
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    let result;
    if (mode === "magick" || mode === "montage") {
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
      const execution = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute({
        command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr.push(bytes.slice()); } }
      });
      result = { ...execution, stdoutBytes: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
    } else {
      result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    }
    if (coder === "bmp") {
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      const image = decodeImage(result.stdoutBytes!);
      expect([image.width, image.height]).toEqual([2, 1]);
      expect([...image.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
    } else {
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no encode delegate for this image format");
      expect(result.stderr).toContain("XC");
      expect(result.stdoutBytes?.length ?? 0).toBe(0);
    }
    expect([...files.keys()]).toEqual([]);
    expect(await fs.readdir("/")).toEqual([]);
  });
}
