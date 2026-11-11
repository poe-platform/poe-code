import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 retains 1x1001 and 1x1000, but removes 0x1001.
// GIF quantizes both nonzero controls to zero centiseconds without dropping them.
for (const mode of ["map", "sync", "filesystem", "command"] as const) {
  for (const format of ["info", "miff", "gif"] as const) {
    it.each(["1x1001", "1x1000", "0x1001"])(`${mode} RemoveZero keeps actual nonzero ticks in ${format}: %s`, async delay => {
      const files = new Map<string, Uint8Array>();
      const fs = new MemoryFileSystem();
      const args = ["-delay", delay, "xc:red", "-delay", "10x100", "xc:blue", "-layers", "RemoveZero",
        ...(format === "info" ? ["-format", "%T:%[pixel:p{0,0}];", "info:"] : [`/out.${format}`])];
      let stdout = "", stderr = "";
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
        stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
      }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
      const output = { stdout, stderr, ...result };
      expect(output).toMatchObject({ exitCode: 0, stderr: "" });
      const keepRed = delay !== "0x1001";
      if (format === "info") {
        expect(output.stdout).toBe(`${keepRed ? "1:srgb(255,0,0);" : ""}10:srgb(0,0,255);`);
        return;
      }
      const bytes = mode === "map" || mode === "sync" ? files.get(`/out.${format}`)! : await fs.readFile(`/out.${format}`);
      const colors = keepRed ? [[255, 0, 0, 255], [0, 0, 255, 255]] : [[0, 0, 255, 255]];
      expect(decodeImage(bytes, { animated: true }).delay).toHaveLength(colors.length);
      for (const [page, color] of colors.entries()) {
        const frame = decodeImage(bytes, { page });
        expect([...frame.data]).toEqual(color);
        if (format === "miff") {
          const rate = keepRed && page === 0 ? Number(delay.split("x")[1]) : 100;
          expect(frame.ticksPerSecond).toBe(rate);
          expect(frame.delay?.[page]).toBe(keepRed && page === 0 ? 1000 / rate : 100);
        }
      }
      if (format === "gif") expect(decodeImage(bytes, { animated: true }).delay).toEqual(keepRed ? [0, 100] : [100]);
    });
  }
}
