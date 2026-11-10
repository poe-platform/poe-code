import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: percentage cutoffs use QuantumRange + 1.
const pixels = [
    [61000, 6000, 0, 0],
    [15000, 48000, 10, 11000],
    [32768, 32767, 32766, 32767],
    [50000, 16000, 38000, 32768],
    [0, 11000, 65535, 65535],
];
const header = new TextEncoder().encode("P7\nWIDTH 5\nHEIGHT 1\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n");
const input = new Uint8Array(header.length + pixels.length * 8);
input.set(header);
pixels.flat().forEach((sample, index) => new DataView(input.buffer).setUint16(header.length + index * 2, sample));

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const channel of ["R", "A"] as const) {
        it.each([
            ["50%", 32768],
            ["32768", 32768],
            ["32767.5", 32767.5],
            ["49.999%", 32767.34464],
        ] as const)(`${mode}: preserves Q16 ${channel} midpoint for %s`, async (threshold, cutoff) => {
            const files = new Map([["in.pam", input], ["out", new TextEncoder().encode("KEEP")]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
            const argv = ["in.pam", "-channel", channel, "-threshold", threshold, "+channel", "PNG64:out"];
            const argumentValues = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
                registerCleanup() {}, fs: filesystem,
            } as unknown as CommandContext) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stdout" in result ? result.stdout : stdout).toBe("");
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
            const expected = pixels.flatMap(pixel => pixel.map((sample, index) => index === (channel === "R" ? 0 : 3) ? (sample > cutoff ? 65535 : 0) : sample));
            expect([...decodeImage(output).data16!]).toEqual(expected);
        });
    }
}
