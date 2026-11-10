import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// RGBA16 expectations captured with ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        { terms: "NaN,1", expected: [0, 0, 0, 65535] },
        { terms: "Infinity,1", expected: [65535, 65535, 65535, 65535] },
        { terms: "1,inf", expected: [0, 0, 0, 65535] },
        { terms: "-inf,1", expected: [0, 0, 0, 65535] },
        { terms: "1e999,1", expected: [65535, 65535, 65535, 65535] },
        { terms: "nanx,1", expected: undefined },
        { terms: "1,1", expected: [32896, 16448, 8224, 65535] },
    ])(`${mode}: handles non-finite polynomial terms $terms`, async ({ terms, expected }) => {
        const previous = new TextEncoder().encode("KEEP");
        const files = new Map([["/out.raw", previous]]), fs = createMemoryFileSystem();
        await fs.writeFile("/out.raw", previous);
        const args = ["-set", "option:coeff", "0.5", "xc:#804020", "xc:#204080",
            "-poly", terms, "-depth", "16", "-endian", "MSB", "PNG64:/out.raw"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect(result, JSON.stringify(result)).toMatchObject({ exitCode: expected ? 0 : 1 });
        const output = mode === "sync" || mode === "map" ? files.get("/out.raw")! : await fs.readFile("/out.raw");
        if (expected) {
            const image = decodeImage(output);
            expect([image.width, image.height]).toEqual([1, 1]);
            expect([...image.data16!]).toEqual(expected);
        } else expect(output).toEqual(previous);
    });
}
