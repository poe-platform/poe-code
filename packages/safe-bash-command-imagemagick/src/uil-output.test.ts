import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI output.
const red = "/* UIL */\nvalue\n  __ct : color_table(\n    color('#FF0000FF',background) = ' ');\n  __icon : icon(color_table = __ct,\n    \"  \");\n";
const strip = "/* UIL */\nvalue\n  __ct : color_table(\n    color('#C2403BFF',background) = ' ',\n    color('#679079FF',foreground) = '.',\n    color('#B6CB3FFF',foreground) = 'X',\n    color('#453ABCFF',background) = 'o',\n    color('#BE3FCFFF',background) = 'O');\n  __icon : icon(color_table = __ct,\n    \" .XoO\");\n";
const ppm = Buffer.concat([Buffer.from("P6\n12 8\n255\n"), Uint8Array.from({ length: 288 }, (_, i) => (i * 53 + i * i * 7) % 256)]);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "red canvas", args: ["-size", "2x1", "xc:red", "uil:-"], expected: Buffer.from(red) },
        { name: "five-color strip", args: ["in.ppm", "+dither", "-colors", "5", "-unique-colors", "uil:-"], expected: Buffer.from(strip) },
        { name: "RGB control", args: ["in.ppm", "+dither", "-colors", "5", "-unique-colors", "-depth", "8", "rgb:-"], expected: Buffer.from("c2403b679079b6cb3f453abcbe3fcf", "hex") }
    ])(`emits $name on stdout (${mode})`, async ({ args, expected }) => {
        const files = new Map([["in.ppm", ppm]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", ppm);
        const argumentValues = createCommandArguments(args), chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : mode === "buffered" ? await runMagickCli(args, files)
            : mode === "retained" ? await runMagickCli(args, { filesystem: fs, cwd: "/" })
            : { ...await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout: "", stdoutBytes: Buffer.concat(chunks), stderr };
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Buffer.from(result.stdoutBytes ?? Buffer.from(result.stdout)).toString("hex")).toBe(expected.toString("hex"));
        expect(files.has("uil:-")).toBe(false);
        await expect(fs.stat("/uil:-")).rejects.toThrow();
    });
}

for (const mode of ["retained", "buffered", "sync"] as const) {
    it.each(["app-icon.uil", "UIL:app-icon.dat"])(`writes named UIL files and preserves intermediate images (${mode}, %s)`, async output => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = ["-size", "2x2", "xc:red", "-write", output, "-depth", "8", "rgb:-"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe("ff0000".repeat(4));
        const path = output.startsWith("UIL:") ? output.slice(4) : output;
        const bytes = mode === "retained" ? await fs.readFile(`/${path}`) : files.get(path)!;
        expect(new TextDecoder().decode(bytes)).toBe(red.replaceAll("__", "app_icon_").replace('    "  ");', '    "  ",\n    "  ");'));
    });
}
