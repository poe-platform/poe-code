import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const samples = [61000, 6000, 0, 0, 15000, 48000, 10, 11000, 32768, 32767, 32766, 32767, 50000, 16000, 38000, 32768, 0, 11000, 65535, 65535];
const header = new TextEncoder().encode("P7\nWIDTH 5\nHEIGHT 1\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n");
const input = new Uint8Array(header.length + samples.length * 2);
input.set(header);
const view = new DataView(input.buffer);
samples.forEach((value, index) => view.setUint16(header.length + index * 2, value));

// Native ImageMagick 7.1.2-35 Q16-HDRI: OTSU property and decoded PNG64 RGBA samples.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        [[], "38.0392%", [0, 1, 1, 0, 0]],
        [["-intensity", "Brightness"], "76.4706%", [1, 0, 0, 0, 1]],
        [["-intensity", "RMS"], "49.8039%", [1, 0, 1, 1, 1]],
        [["-intensity", "Average"], "38.8235%", [0, 0, 1, 1, 1]],
        [["-intensity", "Rec709Luma"], "38.0392%", [0, 1, 1, 0, 0]],
        [["-intensity", "Brightness", "+intensity"], "38.0392%", [0, 1, 1, 0, 0]],
        [["-intensity", "Brightness", "-channel", "RGB"], "76.4706%", undefined],
    ] as const)(`${mode}: classifies auto-threshold pixels with %j`, async (settings, threshold, white) => {
        const files = new Map([["/in.pam", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/in.pam", ...settings, "-auto-threshold", "OTSU", "-write", "PNG64:/out", "-format", "%[auto-threshold:threshold]", "info:"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stdout" in result && typeof result.stdout === "string") stdout = result.stdout;
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(stdout).toBe(threshold);
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!);
        expect([...output.data16!]).toEqual(white
            ? white.flatMap(value => Array<number>(4).fill(value * 65535))
            : [65535, 0, 0, 0, 0, 0, 0, 11000, 0, 0, 0, 32767, 0, 0, 0, 32768, 0, 0, 65535, 65535]);
    });
}
