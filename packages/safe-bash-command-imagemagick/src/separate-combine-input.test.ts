import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each([
        ...["-separate", "-combine"].flatMap(operation => [
            { label: `${operation} before the first image`, args: [operation, "in.pam"], operation },
            { label: `${operation} after deleting all images`, args: ["in.pam", "+delete", operation, "in.pam"], operation },
            { label: `${operation} inside an empty image group`, args: ["in.pam", "(", operation, "in.pam", ")"], operation }
        ]),
        { label: "separate/combine round trip", args: ["in.pam", "-colorspace", "sRGB", "-separate", "-combine"], operation: undefined }
    ])(`${mode}: $label`, async ({ args, operation }) => {
        // Native ImageMagick 7.1.2-35 Q16-HDRI rejects empty lists and preserves KEEP.
        const pixels = Uint8Array.from([0x20, 0x60, 0xb0, 0x80, 0xc8, 0x40, 0x11, 0xef]);
        const input = Uint8Array.from([...new TextEncoder().encode("P7\nWIDTH 2\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), ...pixels]);
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["in.pam", input], ["out", original]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
        const argv = [...args, "-colorspace", "sRGB", "-depth", "8", "rgba:out"];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        expect.soft(result.exitCode).toBe(operation ? 1 : 0);
        expect.soft(result.stdout).toBe("");
        expect.soft(result.stderr).toBe(operation ? `magick: no images found for operation '${operation}'\n` : "");
        expect.soft(output).toEqual(operation ? original : pixels);
    });
}
