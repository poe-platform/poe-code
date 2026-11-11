import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const binary = Buffer.from("50360a3220310a3235350aff00000000ff", "hex");
const gray = Buffer.from("50350a3120310a3235350a80", "hex");
const red = "0:srgb(255,0,0);";

// ImageMagick 7.1.2-35 ignores scene selections when the PNM reader finds one image.
for (const mode of ["buffered", "retained", "command", "sync"] as const) {
    for (const [format, bytes, expected] of [
        ["P6", binary, red],
        ["P3", Buffer.from("P3\n2 1\n255\n255 0 0 0 0 255\n"), red],
        ["P1", Buffer.from("P1\n1 1\n0\n"), "0:gray(255);"],
        ["P2", Buffer.from("P2\n1 1\n255\n128\n"), "0:gray(128);"],
        ["P4", Buffer.from("50340a3120310a00", "hex"), "0:gray(255);"],
        ["P5", gray, "0:gray(128);"],
        ["P7", Buffer.concat([Buffer.from("P7\nWIDTH 1\nHEIGHT 1\nDEPTH 3\nMAXVAL 255\nTUPLTYPE RGB\nENDHDR\n"), Buffer.from([255, 0, 0])]), red]
    ] as const) {
        it.each(["", "[0]", "[1]", "[2]", "[-2]", "[1,0]", "[0,0]", "[1-2]"])(`${mode}: single ${format} input %s keeps scene zero`, async selector => {
            expect(await convert([`in.pnm${selector}`, "-format", "%s:%[pixel:p{0,0}];", "info:"], bytes))
                .toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
        });
    }

    it.each([
        ["", red + "1:gray(128);"], ["[0]", red], ["[1]", "1:gray(128);"], ["[2]", ""]
    ])(`${mode}: concatenated Netpbm input %s still selects and validates scenes`, async (selector, stdout) => {
        const result = await convert([`in.pnm${selector}`, "-format", "%s:%[pixel:p{0,0}];", "info:"], Buffer.concat([binary, gray]));
        expect(result).toMatchObject({ exitCode: selector === "[2]" ? 1 : 0, stdout });
        if (selector === "[2]") expect(result.stderr).toContain("invalid image index 2");
        else expect(result.stderr).toBe("");
    });

    it(`${mode}: a single GIF still rejects an invalid scene`, async () => {
        // Use a misleading extension to check decoded format, not the filename.
        const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
        const result = await convert(["in.pnm[1]", "info:"], gif);
        expect(result).toMatchObject({ exitCode: 1, stdout: "" });
        expect(result.stderr).toContain("invalid image index 1");
    });

    async function convert(args: string[], bytes: Uint8Array) {
        const files = new Map([["in.pnm", bytes]]);
        if (mode === "sync") return runConvertCliSync(args, files);
        if (mode === "buffered") return runConvertCli(args, files);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pnm", bytes);
        if (mode === "retained") return runConvertCli(args, { filesystem, cwd: "/" });
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        return { ...result, stdout, stderr };
    }
}
