import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const pixels = [5000, 5000, 5000, 0, 10000, 10001, 10000, 0, 32767, 32767, 32767, 32768, 50000, 16000, 38000, 32768, 10001, 10000, 10000, 65535];
const input = Uint8Array.from([
    ...new TextEncoder().encode("P7\nWIDTH 5\nHEIGHT 1\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    ...pixels.flatMap(value => [value >> 8, value & 255]),
]);
const roundtrip = ["-colorspace", "Lab", "-colorspace", "sRGB"];
// ImageMagick 7.1.2-35 Q16-HDRI decoded PNG64 samples, including unchanged controls.
const cases = [
    { name: "cropped middle gray", options: ["-crop", "1x1+2+0", "+repage", ...roundtrip], hex: "80017ffe7ffe8000", width: 1 },
    { name: "full image", options: roundtrip, hex: "1389138813880000271127102710000080017ffe7ffe8000c3533e77946f80002712270f2710ffff", width: 5 },
    { name: "untouched middle gray", options: ["-crop", "1x1+2+0", "+repage"], hex: "7fff7fff7fff8000", width: 1 },
    { name: "colored neighbor", options: ["-crop", "1x1+3+0", "+repage", ...roundtrip], hex: "c3533e77946f8000", width: 1 },
    { name: "transparent neighbor", options: ["-crop", "1x1+1+0", "+repage", ...roundtrip], hex: "2711271027100000", width: 1 },
];
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`matches native Q16 Lab $name (${mode})`, async ({ options, hex, width }) => {
        const files = new Map([["/in.pam", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/in.pam", ...options, "PNG64:/out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const image = decodeImage(mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!);
        expect([image.width, image.height]).toEqual([width, 1]);
        expect(Array.from(image.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(hex);
    });
}
