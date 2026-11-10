import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

for (const mode of ["command", "sync"] as const) {
  for (const option of ["-page", "-set", "-repage"] as const) {
    it.each([
      ["A4-1+2", 595, 842, -1, 2],
      ["A4", 595, 842, 0, 0],
      ["Letter+3-1", 612, 792, 3, -1],
      ["a5+4+8", 420, 595, 4, 8],
      ["Legal", 612, 1008, 0, 0],
      ["lettersmall", 612, 792, 0, 0],
      ["A4small", 595, 842, 0, 0],
      ["595x842-1+2", 595, 842, -1, 2],
    ] as const)(`${mode} ${option} paper geometry %s`, async (geometry, width, height, x, y) => {
      const pixels = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 0, 255]);
      const input = await sharp(pixels, { raw: { width: 3, height: 2, channels: 3 } }).png().toBuffer();
      const keep = new TextEncoder().encode("KEEP");
      const files = new Map([["/input.png", input], ["/out.png", keep]]);
      const fs = createMemoryFileSystem();
      for (const [path, bytes] of files) await fs.writeFile(path, bytes);
      const options = [option, ...(option === "-set" ? ["page"] : []), geometry];
      const args = [...(option === "-page" ? [...options, "/input.png"] : ["/input.png", ...options]), "-write", "PNG32:/out.png", "-format", "%wx%h|%g", "info:"];
      let stdout = "";
      const result = mode === "sync" ? runConvertCliSync(args, files)
        : await createMagickCommand().execute({ command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async data => { stdout += typeof data === "string" ? data : new TextDecoder().decode(data); } }, stderr: { write: async () => {} } });
      const rejects = option === "-repage" && geometry !== "595x842-1+2";
      expect(result.exitCode).toBe(rejects ? 1 : 0);
      const output = mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png");
      if (rejects) { expect(output).toEqual(keep); return; }
      expect(mode === "sync" && "stdout" in result ? result.stdout : stdout).toBe(`3x2|${width}x${height}${x < 0 ? x : `+${x}`}${y < 0 ? y : `+${y}`}`);
      const decoded = decodeImage(output);
      expect([decoded.width, decoded.height]).toEqual([3, 2]);
      expect(decoded.virtualCanvas).toEqual({ width, height, x, y });
      expect(decoded.data).toEqual(decodeImage(input).data);
    });
  }
}
