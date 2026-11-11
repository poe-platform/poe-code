import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI fixtures:
// P6\n2 1\n255\n + 0a141e5a6e82, then `magick in.ppm -repage 7x6+X+Y tga:-`.
// TGA retains offsets, but its page dimensions are the raster dimensions.
const fixtures = [
  { x: 2, y: 3, hex: "0000020000000000020003000200010018201e140a826e5a", flattened: "00ff0000ff00" },
  { x: 258, y: 515, hex: "0000020000000000020103020200010018201e140a826e5a", flattened: "00ff0000ff00" },
  { x: 0, y: 0, hex: "0000020000000000000000000200010018201e140a826e5a", flattened: "0a141e5a6e82" },
  { x: 1, y: 0, hex: "0000020000000000010000000200010018201e140a826e5a", flattened: "00ff000a141e" }
];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  for (const operation of ["geometry", "pixels", "flatten"] as const) {
    it.each(fixtures)(`reads TGA page +$x+$y (${mode}, ${operation})`, async ({ x, y, hex, flattened }) => {
      const input = Buffer.from(hex, "hex");
      const files = new Map<string, Uint8Array>([["/in.tga", input]]);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.tga", input);
      const args = ["/in.tga", ...(operation === "geometry"
        ? ["-format", "%g %X %Y %[orientation]", "info:/out"]
        : operation === "pixels" ? ["-depth", "8", "rgba:/out"]
          : ["-background", "lime", "-flatten", "-depth", "8", "rgb:/out"])];
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write() {} }
      }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      expect(result.exitCode).toBe(0);
      const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
      expect(Buffer.from(output).toString(operation === "geometry" ? "utf8" : "hex")).toBe(
        operation === "geometry" ? `2x1+${x}+${y} +${x} +${y} TopLeft`
          : operation === "pixels" ? "0a141eff5a6e82ff" : flattened
      );
    });
  }
}
