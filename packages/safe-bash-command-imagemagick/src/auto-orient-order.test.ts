import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

const input = encodeImage({ width: 2, height: 1, data: Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255),
  format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false, orientation: 6 }, { format: "png" }).data;

for (const mode of ["buffered", "retained", "command"]) {
  it.each([true, false])(`requires an image for auto-orient, beforeInput=%s (${mode})`, async beforeInput => {
    const sentinel = Uint8Array.of(1, 2, 3, 4);
    const files = new Map([["/input.png", input], ["/output.png", sentinel]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = [...(beforeInput ? ["-auto-orient", "/input.png"] : ["/input.png", "-auto-orient"]), "/output.png"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
    }) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(beforeInput ? 1 : 0);
    const output = mode === "buffered" ? files.get("/output.png")! : await fs.readFile("/output.png");
    if (beforeInput) {
      expect("stderr" in result ? result.stderr : stderr).toContain("no images found for operation '-auto-orient'");
      expect(output).toEqual(sentinel);
    } else {
      expect(decodeImage(output)).toMatchObject({ width: 1, height: 2, orientation: 1 });
    }
  });
}
