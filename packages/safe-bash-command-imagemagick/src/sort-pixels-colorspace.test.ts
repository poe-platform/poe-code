import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const original = "d02030302050e000d0203030608040f01122330080808070808080e090102080";
// ImageMagick 7.1.2-35 Q16-HDRI reference: stable row order, including hidden RGB and alpha ties.
const cases = [
    { space: "HSL", sort: true, expected: "608040f02050e000d0203030d020303080808070808080e01122330090102080" },
    { space: "Lab", sort: true, expected: "608040f02050e000d0203030d02030301122330080808070808080e090102080" },
    { space: "XYZ", sort: true, expected: "608040f0d0203030d02030302050e000112233009010208080808070808080e0" },
    { space: "sRGB", sort: true, expected: "d0203030d02030302050e000608040f0112233009010208080808070808080e0" },
    { space: "HSL", sort: false, expected: original }
];

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each(cases)(`${mode}: sorts in $space (sort=$sort) before converting back to sRGB`, async ({ space, sort, expected }) => {
        const input = Uint8Array.from([
            ...new TextEncoder().encode("P7\nWIDTH 4\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
            ...Buffer.from(original, "hex")
        ]);
        const files = new Map([["in.pam", input], ["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
        const args = ["in.pam", "-colorspace", space, ...sort ? ["-sort-pixels"] : [], "-colorspace", "sRGB", "-depth", "8", "rgba:out"];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
