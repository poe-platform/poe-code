import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI headers and raster bytes.
const fixtures = [
    { magic: "Pf", halfMagic: "Ph", dimensions: "2 1", raster: "3e0000003f000000", halfRaster: "30003800" },
    { magic: "PF", halfMagic: "PH", dimensions: "1 2", raster: "3e0000003e8000003f0000003f8000003f4000003e800000", halfRaster: "3000340038003c003a003400" }
];

for (const sync of [false, true]) for (const format of ["pfm", "phm"]) for (const comment of [undefined, "", "first line\nsecond line"]) {
    it.each(fixtures)(`writes $magic as ${format} with unchanged samples, comment=${JSON.stringify(comment)}, sync=${sync}`, async fixture => {
        const input = Buffer.concat([Buffer.from(`${fixture.magic}\n${fixture.dimensions}\n1.0\n`), Buffer.from(fixture.raster, "hex")]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.pfm", input);
        const args = createCommandArguments(["in.pfm", ...(comment === undefined ? [] : ["-set", "comment", comment]), `${format}:-`]);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const syncResult = sync ? runMagickCliSync(args.args, new Map([["in.pfm", input]])) : undefined;
        const result = syncResult ?? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect(syncResult ? syncResult.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const header = `${format === "phm" ? fixture.halfMagic : fixture.magic}\n${comment ? "#first line\n#second line\n" : ""}${fixture.dimensions}\n1.0\n`;
        const expected = Buffer.concat([Buffer.from(header), Buffer.from(format === "phm" ? fixture.halfRaster : fixture.raster, "hex")]);
        expect(syncResult ? Buffer.from(syncResult.stdoutBytes!) : Buffer.concat(chunks)).toEqual(expected);
    });
}
