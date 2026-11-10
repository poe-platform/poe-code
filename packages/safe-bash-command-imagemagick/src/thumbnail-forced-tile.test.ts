import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, PPM RGB8 pixels.
for (const [geometry, hex] of [["3x1!", "7f009180804080ff00"], ["1x1", "808040"]] as const)
for (const montage of [false, true])
for (const mode of ["command", "buffered", "sync"]) {
    it(`${mode}: ${montage ? "montage" : "magick"} thumbnail ${geometry} matches native tile pixels`, async () => {
        const source = Buffer.concat([Buffer.from("P6\n2 2\n255\n"), Buffer.from("ff000000ff000000ffffff00", "hex")]);
        const files = new Map<string, Uint8Array>([["/tile.ppm", source]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/tile.ppm", source);
        const argv = [...(montage ? ["montage", "-geometry", "+0+0", "-tile", "x1"] : []), "/tile.ppm", "-thumbnail", geometry, "-depth", "8", "/out.ppm"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" ? await fs.readFile("/out.ppm") : files.get("/out.ppm")!;
        expect(Buffer.from(output)).toEqual(Buffer.concat([
            Buffer.from(`P6\n${geometry === "3x1!" ? "3 1" : "1 1"}\n255\n`), Buffer.from(hex, "hex")
        ]));
    });
}
