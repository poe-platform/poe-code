import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["command", "map"] as const) {
    it.each(["bezier 0,0 0,4 6,4 6,0", "bezier 0,0 3,6 6,0"])(`${mode}: fills the interior of %s independently of stroke`, async draw => {
        for (const fill of ["red", "none"]) {
            const fs = new MemoryFileSystem();
            const keep = new TextEncoder().encode("keep");
            const files = new Map([["/out.png", keep]]);
            await fs.writeFile("/out.png", keep);
            const args = ["-size", "7x5", "xc:white", "-fill", fill,
                ...(fill === "none" ? ["-stroke", "blue"] : []), "-draw", draw, "/out.png"];
            const result = mode === "map" ? await runConvertCli(args, files) : await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async () => {} },
            });
            expect(result.exitCode).toBe(0);
            const output = decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png"));
            const pixel = (y: number) => Array.from(output.data.subarray((y * 7 + 3) * 4, (y * 7 + 4) * 4));
            if (fill === "red") {
                for (const y of [0, 1, 2]) expect(pixel(y)).toEqual([255, 0, 0, 255]);
            } else {
                expect(pixel(0)).toEqual([255, 255, 255, 255]);
                expect(pixel(3)).toEqual([0, 0, 255, 255]);
            }
        }
    });
}
