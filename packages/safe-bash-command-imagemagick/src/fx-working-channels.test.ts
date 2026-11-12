import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    async function convert(args: string[]) {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        return Buffer.from(mode === "sync" || mode === "buffered" ? files.get("/out")! : await fs.readFile("/out")).toString("hex");
    }

    for (const space of ["HSL", "Lab", "CMYK", "RGB", "sRGB"]) {
        // ImageMagick 7 Q16-HDRI exports a literal 0.5 as 8000 in every working channel.
        it.each([1, 513])(`${mode}: ${space} FX updates working channels across %i pixels`, async width => {
            expect(await convert(["-size", `${width}x1`, "xc:#a653b580", "-colorspace", space,
                "-fx", "0.5", "-channel", "R", "-separate", "-depth", "16", "-endian", "MSB", "gray:/out"]))
                .toBe("8000".repeat(width));
        });

        it(`${mode}: ${space} FX reads its working result and preserves unselected channels`, async () => {
            expect(await convert(["xc:#a653b580", "-colorspace", space, "-fx", "0.5",
                "-channel", "R", "-fx", "u/2", "-channel", "RGBA", "-separate", "-depth", "16", "-endian", "MSB", "gray:/out"]))
                .toBe("4000800080008000");
        });
    }

    it.each([
        { space: "HSL", expected: "676665fb84848080" },
        { space: "Lab", expected: "3ec6b1295a448080" },
        { space: "CMYK", expected: "0a9c8a9b00008080" }
    ])(`${mode}: $space FX changes only the selected source channel`, async ({ space, expected }) => {
        expect(await convert(["xc:#a653b580", "-colorspace", space, "-channel", "R", "-fx", "u/2",
            "-channel", "RGBA", "-separate", "-depth", "16", "-endian", "MSB", "gray:/out"]))
            .toBe(expected);
    });

    it.each(["HSL", "Lab", "CMYK"])(`${mode}: %s FX reads another image's working channels`, async space => {
        expect(await convert(["xc:#a653b580", "-colorspace", space,
            "(", "xc:#a653b580", "-colorspace", space, "-fx", "0.25", ")", "-fx", "v.p{0,0}",
            "-channel", "RGBA", "-separate", "-depth", "16", "-endian", "MSB", "gray:/out"]))
            .toBe("4000400040004000");
    });

    it(`${mode}: CMYK black and alpha are separate FX channels`, async () => {
        expect(await convert(["-size", "513x1", "xc:#a653b580", "-colorspace", "CMYK", "-fx", "0.5",
            "-channel", "K", "-fx", "u/2", "-channel", "A", "-fx", "0.75",
            "-channel", "RGBAK", "-separate", "-depth", "16", "-endian", "MSB", "gray:/out"]))
            .toBe(["8000", "8000", "8000", "4000", "bfff"].map(value => value.repeat(513)).join(""));
    });
}
