import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Uncompressed 4x2 RGBA MIFF layout from ImageMagick 7.1.2-35 Q16-HDRI.
const pixels = Buffer.from("1234abcdff0080ff1234abcd55660080".repeat(2), "hex");
const cases = [
    { fields: "", resolution: "72|72|Undefined", size: "4x2" },
    { fields: "resolution=150x72\nunits=PixelsPerInch", resolution: "150|72|PixelsPerInch", size: "2x2" },
    { fields: "resolution=150x72\nunits=PixelsPerCentimeter", resolution: "150|72|PixelsPerCentimeter", size: "2x2" },
    { fields: "resolution=150x72\nunits=Undefined", resolution: "150|72|Undefined", size: "2x2" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const { fields, resolution, size } of cases) {
        for (const resample of [false, true]) {
            it(`reads MIFF resolution ${resolution}, resample=${resample} (${mode})`, async () => {
                const input = Buffer.concat([
                    Buffer.from(`id=ImageMagick version=1.0\nclass=DirectClass colors=0 matte=True\ncolumns=4 rows=2 depth=8\ncolorspace=sRGB compression=None\n${fields}\n\f\n:\x1a`),
                    pixels,
                ]);
                const fs = new MemoryFileSystem();
                await fs.writeFile("/in.miff", input);
                const files = new Map([["/in.miff", input]]);
                const args = ["/in.miff", ...(resample ? ["-resample", "75x72"] : []), "-format", resample ? "%wx%h" : "%x|%y|%U", "info:"];
                let result;
                if (mode === "command") {
                    let stdout = "", stderr = "";
                    const argumentValues = createCommandArguments(args);
                    const status = await createMagickCommand().execute({
                        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                        stdin: (async function* () {})(), signal: new AbortController().signal,
                        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                    });
                    result = { ...status, stdout, stderr };
                } else result = mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result).toEqual({ exitCode: 0, stdout: resample ? size : resolution, stderr: "" });
            });
        }
    }
}
