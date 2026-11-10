import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const samples = [
    5000, 5000, 5000, 0, 10000, 10001, 10000, 0, 32767, 32767, 32767, 32768,
    50000, 16000, 38000, 32768, 10001, 10000, 10000, 65535
];
const pixels = Buffer.alloc(samples.length * 2);
samples.forEach((value, index) => pixels.writeUInt16BE(value, index * 2));
const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 5\nHEIGHT 1\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), pixels
]);

// ImageMagick 7.1.2-35 Q16-HDRI PNG64 samples, decoded as RGBA16.
const expected = {
    "-negate": [60535, 60535, 60535, 65535, 55535, 55534, 55535, 65535, 32768, 32768, 32768, 32767,
        15535, 49535, 27535, 32767, 55534, 55535, 55535, 0],
    "+negate": [60535, 60535, 60535, 65535, 10000, 10001, 10000, 0, 32768, 32768, 32768, 32767,
        50000, 16000, 38000, 32768, 10001, 10000, 10000, 65535]
};

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    for (const operator of ["-negate", "+negate"] as const) {
        it.each([
            { label: "before the first image", prefix: [], suffix: ["in.pam"], valid: false },
            { label: "after deleting all images", prefix: ["in.pam", "+delete"], suffix: ["in.pam"], valid: false },
            { label: "inside an empty image group", prefix: ["in.pam", "("], suffix: ["in.pam", ")"], valid: false },
            { label: "after the input image", prefix: ["in.pam"], suffix: [], valid: true }
        ])(`${mode}: ${operator} $label`, async ({ prefix, suffix, valid }) => {
            const original = Buffer.from("KEEP");
            const files = new Map([["in.pam", input], ["out", original]]);
            const fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
            const args = [...prefix, operator, ...suffix, "+channel", "PNG64:out"];
            let stdout = "", stderr = "";
            const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
            expect.soft(result.exitCode).toBe(valid ? 0 : 1);
            expect.soft(result.stdout).toBe("");
            if (valid) {
                expect(result.stderr).toBe("");
                expect(Array.from(decodeImage(output).data16!)).toEqual(expected[operator]);
            } else {
                expect.soft(result.stderr).toContain(`no images found for operation '${operator}'`);
                expect.soft(Array.from(output)).toEqual(Array.from(original));
            }
        });
    }
}
