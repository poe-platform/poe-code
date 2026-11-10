import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const samples = [
    61000, 6000, 0, 0, 15000, 48000, 10, 11000, 32768, 32767, 32766, 32767,
    50000, 16000, 38000, 32768, 0, 11000, 65535, 65535,
];
const header = new TextEncoder().encode("P7\nWIDTH 5\nHEIGHT 1\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n");
const input = new Uint8Array(header.length + samples.length * 2);
input.set(header);
samples.forEach((value, index) => new DataView(input.buffer).setUint16(header.length + index * 2, value));

// ImageMagick 7.1.2-35 Q16-HDRI rejects empty lists and preserves the destination.
const operations = [
    ["-threshold", "50%"], ["-black-threshold", "50%"], ["-white-threshold", "50%"],
    ["-auto-threshold", "OTSU"], ["-range-threshold", "10%,25%,60%,80%"],
];
for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    for (const placement of ["before input", "after delete", "empty group", "after input"] as const) {
        it.each(placement === "after input" ? [operations[0]!] : operations)(`${mode}: %s ${placement} preserves output or produces native pixels`, async (option, value) => {
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([["/in.pam", input], ["/out", original]]);
            const fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile(name, bytes);
            const argv = placement === "after input" ? ["/in.pam", option, value, "+channel", "PNG64:/out"]
                : placement === "empty group" ? ["/in.pam", "(", option, value, "/in.pam", ")", "PNG64:/out"]
                : [...(placement === "after delete" ? ["/in.pam", "+delete"] : []), option, value, "/in.pam", "PNG64:/out"];
            let stdout = "", stderr = "";
            const argumentValues = createCommandArguments(argv);
            const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }), stdout, stderr } : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
            expect.soft(result.stdout).toBe("");
            if (placement === "after input") {
                expect(result.exitCode, result.stderr).toBe(0);
                expect(result.stderr).toBe("");
                const image = decodeImage(output);
                expect([image.width, image.height]).toEqual([5, 1]);
                expect([...image.data16!]).toEqual([
                    0, 0, 0, 0, 65535, 65535, 65535, 65535,
                    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                ]);
            } else {
                expect.soft(result.exitCode).toBe(1);
                expect.soft(result.stderr).toContain(`no images found for operation '${option}'`);
                expect.soft(output).toEqual(original);
            }
        });
    }
}
