import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI results, including hidden RGB and partial alpha.
const pixels = [61000, 6000, 0, 0, 15000, 48000, 10, 11000, 32768, 32767, 32766, 32767, 50000, 16000, 38000, 32768, 0, 11000, 65535, 65535];
const header = new TextEncoder().encode("P7\nWIDTH 5\nHEIGHT 1\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n");
const input = new Uint8Array(header.length + pixels.length * 2);
input.set(header);
const view = new DataView(input.buffer);
pixels.forEach((value, index) => view.setUint16(header.length + index * 2, value));

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { settings: [], after: [], white: [false, true, false, false, false] },
        { settings: ["-intensity", "Brightness"], after: [], white: [true, true, false, true, true] },
        { settings: ["-intensity", "Average"], after: [], white: [false, false, false, true, false] },
        { settings: ["-intensity", "Rec601Luma"], after: [], white: [false, false, false, false, false] },
        { settings: ["-intensity", "Rec709Luma"], after: [], white: [false, true, false, false, false] },
        { settings: [], after: ["+channel"], white: [false, true, false, false, false] },
        { settings: ["-intensity", "Brightness", "+intensity"], after: [], white: [false, true, false, false, false] },
    ])(`${mode}: plain threshold honors $settings with $after`, async ({ settings, after, white }) => {
        const files = new Map([["/in.pam", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/in.pam", ...settings, "-threshold", "50%", ...after, "PNG64:/out"];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect(mode === "command" ? stdout : "stdout" in result ? result.stdout : "").toBe("");
        expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : "").toBe("");
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!);
        expect([...output.data16!]).toEqual(white.flatMap(value => Array<number>(4).fill(value ? 65535 : 0)));
    });
}
