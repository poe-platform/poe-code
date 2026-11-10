import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: a later mask adds a zero-filled channel,
// even when the polynomial does not use that image.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        { mask: "white", terms: "1,1", after: [], output: "info", expected: "srgb  4.0" },
        { mask: "white", terms: "1,1", after: [], output: "PNG64", expected: [32896, 16448, 8224, 0] },
        { mask: "black", terms: "0.5,1,0.5,1", after: [], output: "PNG64", expected: [20560, 16448, 20560, 0] },
        { mask: "white", terms: "1,1", after: ["-negate", "+write-mask"], output: "info", expected: "srgb  3.0" },
        { mask: "black", terms: "0.5,1,0.5,1", after: ["+write-mask"], output: "PNG64", expected: [20560, 16448, 20560, 65535] },
        { mask: "white", terms: "1,,1", after: [], output: "PNG64", expected: "KEEP", exitCode: 1 },
    ])(`${mode}: preserves later $mask mask with $terms $after $output`, async ({ mask, terms, after, output, expected, exitCode = 0 }) => {
        const previous = new TextEncoder().encode("KEEP"), files = new Map([["/out.raw", previous]]), fs = createMemoryFileSystem();
        await fs.writeFile("/out.raw", previous);
        const args = ["xc:#804020", "(", "xc:#204080", "-write-mask", `xc:${mask}`, ")", "-poly", terms,
            ...after, "-depth", "16", "-endian", "MSB", "-format", "%[channels]", `${output}:/out.raw`];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(exitCode);
        const bytes = mode === "sync" || mode === "map" ? files.get("/out.raw")! : await fs.readFile("/out.raw");
        if (typeof expected === "string") expect(new TextDecoder().decode(bytes)).toBe(expected);
        else expect([...decodeImage(bytes).data16!]).toEqual(expected);
    });
}
