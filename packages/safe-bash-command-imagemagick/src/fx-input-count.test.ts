import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  for (const count of [1, 2, 3]) {
    it.each([false, true])(`${mode}: n counts ${count} input images, red only: %s`, async redOnly => {
      const input = encodeImage({ width: 2, height: 1, data: Uint8Array.from([16, 32, 48, 255, 64, 80, 96, 255]), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false }, { format: "png", forceOpaque: true }).data;
      const files = new Map([["/input.png", input]]);
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/input.png", input);
      const args = [...Array<string>(count).fill("/input.png"), ...(redOnly ? ["-channel", "R"] : []), "-fx", "n/4", "/out.png"];
      const argumentValues = createCommandArguments(args);
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
        signal: new AbortController().signal, registerCleanup() {},
      }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result.exitCode).toBe(0);
      const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
      const value = Math.round(count / 4 * 255);
      expect(Array.from(decodeImage(output).data)).toEqual(redOnly
        ? [value, 32, 48, 255, value, 80, 96, 255]
        : [value, value, value, 255, value, value, value, 255]);
    });
  }
}
