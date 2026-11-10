import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI decoded RGBA16 reference pixels.
const synchronized = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff9d659d659d659d65";
for (const mode of ["magick", "buffered", "retained", "sync"] as const) {
    it.each([
        [[], synchronized],
        [["-channel", "Default"], synchronized],
        [["-channel", "dEfAuLt"], synchronized],
        [["-channel", "R", "-channel", "Default"], synchronized],
        [["-channel", "R", "+channel"], synchronized],
        [["-channel", "R"], "0000177000000000dbf6bb80000a2af8ffff7fff7ffe7fff2f6c3e809470800000002af8ffffffff"],
    ] as [string[], string][])(`${mode}: range threshold synchronizes default channels %j`, async (channels, expected) => {
        const pixels = [61000, 6000, 0, 0, 15000, 48000, 10, 11000, 32768, 32767, 32766, 32767, 50000, 16000, 38000, 32768, 0, 11000, 65535, 65535];
        const data = Buffer.alloc(pixels.length * 2);
        pixels.forEach((value, index) => data.writeUInt16BE(value, index * 2));
        const input = Buffer.concat([Buffer.from("P7\nWIDTH 5\nHEIGHT 1\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), data]);
        const files = new Map([["/in.pam", input], ["/out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/in.pam", ...channels, "-range-threshold", "10%,25%,60%,80%", "+channel", "PNG64:/out"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "magick" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect(stdout).toBe("");
        expect(stderr).toBe("");
        if ("stdout" in result) expect(result.stdout).toBe("");
        if ("stderr" in result) expect(result.stderr).toBe("");
        const output = decodeImage(mode === "magick" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!);
        expect([output.width, output.height]).toEqual([5, 1]);
        expect(Array.from(output.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(expected);
    });
}
