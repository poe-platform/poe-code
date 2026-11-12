import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI PPM pixels, in big-endian sample order.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
  for (const source of ["generator", "file"] as const) {
    it.each([
      { background: "#253648597b8c", alpha: "0000", depth: "16", hex: "253648597b8c" },
      { background: "#253648597b8c", alpha: "7654", depth: "16", hex: "1c6d4ee089f6" },
      { background: "black", alpha: "7654", depth: "16", hex: "086a27f84786" },
      { background: "#253648597b8c", alpha: "ffff", depth: "16", hex: "123456789abc" },
      { background: "#253648597b8c", alpha: "7654", depth: "8", hex: "1c4f89" }
    ])(`${mode} ${source}: composites alpha $alpha over $background at depth $depth`, async ({ background, alpha, depth, hex }) => {
      const args = ["-geometry", source === "generator" ? "1x1+0+0" : "+0+0", "-tile", "x1", "-background", background,
        source === "generator" ? `xc:#123456789abc${alpha}` : "/tile.pam", "-depth", depth, "ppm:-"];
      const fs = new MemoryFileSystem();
      const files = new Map<string, Uint8Array>();
      if (source === "file") {
        const tile = Buffer.concat([
          Buffer.from("P7\nWIDTH 1\nHEIGHT 1\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
          Buffer.from(`123456789abc${alpha}`, "hex")
        ]);
        files.set("/tile.pam", tile);
        await fs.writeFile("/tile.pam", tile);
      }
      let output: Uint8Array;
      if (mode === "magick" || mode === "montage") {
        const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
        const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
        const result = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute({
          command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
          stderr: { async write(bytes) { stderr.push(bytes.slice()); } }
        });
        expect(result.exitCode).toBe(0);
        expect(stderr).toEqual([]);
        output = Buffer.concat(stdout);
      } else {
        const result = mode === "sync" ? runMontageCliSync(args, files)
          : await runMontageCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        output = result.stdoutBytes!;
      }
      expect(Buffer.from(output)).toEqual(Buffer.concat([
        Buffer.from(`P6\n1 1\n${depth === "16" ? "65535" : "255"}\n`), Buffer.from(hex, "hex")
      ]));
    });
  }
}
