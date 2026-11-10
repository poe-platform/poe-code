import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: decoded PNG64 RGBA samples.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        ["1+1", [32896, 16448, 8224, 65535]],
        ["1-1", [65535, 65535, 65535, 65535]],
        ["1.0.5", [46431, 32832, 23216, 65535]],
        ["1e-1+1", [3290, 1645, 822, 65535]],
        ["1,+1", [32896, 16448, 8224, 65535]],
        ["1,-1", [65535, 65535, 65535, 65535]],
        ["1,0.5", [46431, 32832, 23216, 65535]],
        ["1e-1,1", [3290, 1645, 822, 65535]],
        ["1++1", null],
        ["1e-+1", null],
        ["1.0.5x", null],
        ["1,,1", null],
    ])(`${mode}: parses adjacent polynomial terms %s`, async (polynomial, expected) => {
        const previous = new TextEncoder().encode("KEEP");
        const files = new Map([["/out.raw", previous]]), fs = createMemoryFileSystem();
        await fs.writeFile("/out.raw", previous);
        const args = ["-set", "option:coeff", "0.5", "xc:#804020", "xc:#204080", "-poly", polynomial,
            "-depth", "16", "-endian", "MSB", "PNG64:/out.raw"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(expected ? 0 : 1);
        const output = mode === "sync" || mode === "map" ? files.get("/out.raw")! : await fs.readFile("/out.raw");
        if (expected) expect([...decodeImage(output).data16!]).toEqual(expected);
        else expect(output).toEqual(previous);
    });
}
