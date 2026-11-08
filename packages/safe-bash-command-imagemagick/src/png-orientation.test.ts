import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick PNG24: red then blue, with RightTop in an orNT chunk.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAAW9yTlQGUcbiOQAAAA9JREFUCNdj+M/AwMDwHwAHAAH/dtWnYAAAAABJRU5ErkJggg==", "base64");

for (const mode of ["buffered", "retained", "command"]) {
  it.each([false, true])(`preserves PNG orientation and applies auto-orient=%s, mode=${mode}`, async autoOrient => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const files = new Map([["/input.png", new Uint8Array(input)]]);
    const args = ["/input.png", ...(autoOrient ? ["-auto-orient"] : []), "/output.png"];
    if (mode === "command") {
      let stderr = "";
      const result = await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args,
        cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} },
        stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
      });
      expect(result).toMatchObject({ exitCode: 0 });
      expect(stderr).toBe("");
    } else {
      expect(await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    }
    const output = mode === "buffered" ? files.get("/output.png")! : await fs.readFile("/output.png");
    const decoded = decodeImage(output);
    expect(decoded).toMatchObject({ width: autoOrient ? 1 : 2, height: autoOrient ? 2 : 1, orientation: autoOrient ? 1 : 6 });
    expect(Array.from(decoded.data)).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
    const native = spawnSync("magick", ["identify", "-format", "%wx%h|%[orientation]", "-"], { input: output, encoding: "utf8" });
    expect(native.status, native.stderr).toBe(0);
    expect(native.stdout).toBe(autoOrient ? "1x2|TopLeft" : "2x1|RightTop");
  });
}
