import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, PNG64 output decoded as big-endian RGBA16.
const cases = [
    { space: "HSL", control: "40408080c0c08080", minus: "be1f8065ea59b55f", plus: "301f50e2317d4081" },
    { space: "HSV", control: "40408080c0c08080", minus: "926d28c3de22b55f", plus: "50a1912153514081" },
    { space: "Lab", control: "40458080c0bf8080", minus: "ffff86b18be8b55f", plus: "0000ba8cffff4081" },
    { space: "XYZ", control: "40458080c0bf8080", minus: "a469b385dabfb55f", plus: "000066cda4384081" },
].flatMap(({ space, control, minus, plus }) => [
    { space, options: [], expected: control },
    { space, options: ["-gamma", "2"], expected: minus },
    { space, options: ["+gamma", "2"], expected: plus },
    { space, options: ["-channel", "Black", "-gamma", "2", "+channel"], expected: control },
    { space, options: ["-channel", "Black", "+gamma", "2", "+channel"], expected: control },
]);

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`${mode}: preserves $space $options through sRGB conversion`, async ({ space, options, expected }) => {
        const args = ["xc:#4080c080", "-colorspace", space, ...options, "-colorspace", "sRGB", "PNG64:/out.png"];
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        const decoded = decodeImage(output);
        expect(decoded.depth).toBe("ushort");
        expect(Array.from(decoded.data16 ?? [], value => value.toString(16).padStart(4, "0")).join("")).toBe(expected);
    });
}
