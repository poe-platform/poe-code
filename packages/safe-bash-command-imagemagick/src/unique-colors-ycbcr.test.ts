import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: YCbCr palettes put red before #010101.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { name: "red then gray", colors: ["ff0000", "010101"], unique: true },
        { name: "gray then red", colors: ["010101", "ff0000"], unique: true },
        { name: "duplicates", colors: ["010101", "ff0000", "010101", "ff0000"], unique: true },
        { name: "16-bit PPM", colors: ["010101", "ff0000", "010101"], unique: true, ppm: true },
        { name: "red then gray round trip", colors: ["ff0000", "010101"], unique: false },
        { name: "gray then red round trip", colors: ["010101", "ff0000"], unique: false },
    ])(`${mode}: preserves native YCbCr $name`, async ({ colors, unique, ppm }) => {
        const input = Buffer.concat([
            Buffer.from(`P6\n${colors.length} 1\n65535\n`),
            Buffer.from(Array.from(Buffer.from(colors.join(""), "hex")).flatMap(value => [value, value])),
        ]);
        const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = [...(ppm ? ["/in.ppm"] : [...colors.map(color => `xc:#${color}`), "+append"]),
            "-colorspace", "YCbCr", ...(unique ? ["-unique-colors"] : []),
            "-colorspace", "sRGB", "PNG32:/out.png"];
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
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        const image = decodeImage(output);
        expect([image.width, image.height]).toEqual([unique ? 2 : colors.length, 1]);
        expect(Buffer.from(image.data).toString("hex")).toBe((unique ? ["ff0000", "010101"] : colors).map(color => `${color}ff`).join(""));
    });
}
