import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const original = "d02030302050e07030903060c01060e0112233508080804080a080b090102080";
// ImageMagick 7.1.2-35 Q16-HDRI, converted back to sRGB and cropped to the top-left pixel.
const cases = [
    { space: "HSL", operation: ["-rotational-blur", "60"], channel: [], expected: "861f8c39" },
    { space: "Lab", operation: ["-rotational-blur", "60"], channel: ["-channel", "R"], expected: "aa002930" },
    { space: "sRGB", operation: ["-rotational-blur", "60"], channel: [], expected: "84213139" },
    { space: "Lab", operation: ["-motion-blur", "2x1+35"], channel: [], expected: "ac6c5d40" },
    { space: "HSL", operation: ["-motion-blur", "2x1+35"], channel: ["-channel", "R"], expected: "20d0cc30" },
    { space: "sRGB", operation: ["-motion-blur", "2x1+35"], channel: [], expected: "a25e5e40" },
    { space: "HSL", operation: [], channel: [], expected: "d0203030" }
];

for (const mode of ["buffered", "sync", "retained", "magick"] as const) {
    it.each(cases)(`${mode}: blurs working $space channels $channel with $operation`, async ({ space, operation, channel, expected }) => {
        const input = Uint8Array.from([
            ...new TextEncoder().encode("P7\nWIDTH 4\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
            ...Buffer.from(original, "hex")
        ]);
        const files = new Map([["in.pam", input], ["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
        const args = ["in.pam", "-colorspace", space, ...channel, ...operation, "+channel", "-colorspace", "sRGB", "-crop", "1x1+0+0", "+repage", "-depth", "8", "rgba:out"];
        let stdout = "", stderr = "";
        const result = mode === "magick" ? { ...await createMagickCommand().execute({
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
