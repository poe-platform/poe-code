import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { encodeImage } from "@poe-code/image-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";


for (const mode of ["sync", "buffered", "command"]) for (const hasAlpha of [false, true]) {
    for (const [type, raster] of [["Bilevel", "00ff"], ["Grayscale", "2fc8"], ["GrayscaleAlpha", hasAlpha ? "2f80c800" : "2fffc8ff"]]) {
        it(`coerces colored pixels to ${type}, mode=${mode}, alpha=${hasAlpha}`, async () => {
            const input = encodeImage({ width: 2, height: 1, data: new Uint8Array([18, 52, 86, 128, 171, 205, 239, 0]), hasAlpha, space: "srgb", format: "png", channels: hasAlpha ? 4 : 3, depth: "uchar", density: 72 }, { format: "png", pngColorType: hasAlpha ? 6 : 2 }).data;
            const files = new Map([["in.png", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const args = ["in.png", "-type", type!, "out.pam"];
            const result = mode === "sync" ? runMagickCliSync(args, files) : mode === "buffered" ? await runMagickCli(args, files) : await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async () => {} },
            });
            if ("stderr" in result) expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const output = mode === "command" ? await filesystem.readFile("/out.pam") : files.get("out.pam")!;
            const alpha = type === "GrayscaleAlpha";
            expect(Buffer.from(output)).toEqual(Buffer.concat([
                Buffer.from(`P7\nWIDTH 2\nHEIGHT 1\nDEPTH ${alpha ? 2 : 1}\nMAXVAL 255\nTUPLTYPE ${alpha ? "GRAYSCALE_ALPHA" : "GRAYSCALE"}\nENDHDR\n`),
                Buffer.from(raster!, "hex")
            ]));
        });
    }
}

it.each([{ value: [] }, { value: ["TrueColorTypo"] }])("rejects unsupported or missing image types: $value", ({ value }) => {
    const result = runMagickCliSync(["xc:red", "-type", ...value, "out.pam"], new Map());
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unsupported image type");
});
