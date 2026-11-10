import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35: display defaults do not become PNG pHYs metadata.
for (const mode of ["buffered", "sync", "retained", "command"]) {
  for (const placement of ["before", "after"]) {
    it.each([
      { units: "PixelsPerCentimeter", density: "x50", display: "28.346456692913385/50", physical: undefined },
      { units: "PixelsPerCentimeter", density: "100x0", display: "100/28.346456692913385", physical: undefined },
      { units: "PixelsPerInch", density: "0x50", display: "72/50", physical: undefined },
      { units: "PixelsPerCentimeter", density: "100x50", display: "100/50", physical: [10000, 5000, 1] },
      { units: "Undefined", density: undefined, display: "72/72", physical: undefined },
    ])(`keeps $density display separate from PNG resolution (${mode}, ${placement} input)`, async ({ units, density, display, physical }) => {
      const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
      const settings = ["-units", units, ...(density === undefined ? [] : ["-density", density])];
      const args = [...(placement === "before" ? settings : []), "xc:red",
        ...(placement === "after" ? settings : []), "-write", "PNG24:/out.png", "-format", "%x/%y/%U", "info:-"];
      let stdout = "", stderr = "";
      const result = mode === "command"
        ? await createMagickCommand().execute({ command: "magick", args: createCommandArguments(args).args,
          cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } })
        : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result.exitCode).toBe(0);
      expect("stderr" in result ? result.stderr : stderr).toBe("");
      expect.soft("stdout" in result ? result.stdout : stdout).toBe(`${display}/${units}`);
      const output = mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png");
      let resolution: number[] | undefined;
      for (let offset = 8; offset + 12 <= output.length;) {
        const view = new DataView(output.buffer, output.byteOffset + offset);
        const length = view.getUint32(0);
        if (new TextDecoder().decode(output.subarray(offset + 4, offset + 8)) === "pHYs") {
          resolution = [view.getUint32(8), view.getUint32(12), view.getUint8(16)];
        }
        offset += length + 12;
      }
      expect(resolution).toEqual(physical);
    });
  }
}
