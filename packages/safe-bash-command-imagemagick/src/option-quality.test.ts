import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n8 6\n255\n"), Uint8Array.from({ length: 144 }, (_, i) => (i * 67 + 19) % 256)]);
const jpeg = encodeImage(decodeImage(input), { format: "jpeg", quality: 83 }).data;

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        // Native ImageMagick reports 92, 37, 92, and 37 for these four PPM cases.
        { name: "default", args: ["in.ppm"], quality: 92 },
        { name: "direct quality", args: ["in.ppm", "-quality", "37"], quality: 37 },
        { name: "unqualified property", args: ["in.ppm", "-set", "quality", "37"], quality: 92 },
        { name: "option after input", args: ["in.ppm", "-set", "option:quality", "37"], quality: 37 },
        { name: "option before input", args: ["-set", "option:quality", "37", "in.ppm"], quality: 37 },
        { name: "override inherited JPEG quality", args: ["in.jpg", "-set", "option:quality", "37"], quality: 37 },
        { name: "override future JPEG quality", args: ["-set", "option:quality", "37", "in.jpg"], quality: 37 },
        { name: "option after direct quality", args: ["in.jpg", "-quality", "75", "-set", "option:quality", "37"], quality: 37 },
        { name: "direct quality after option", args: ["in.jpg", "-set", "option:quality", "37", "-quality", "75"], quality: 75 },
        { name: "expanded option", args: ["in.ppm", "-set", "option:quality", "%[fx:w*4+5]"], quality: 37 },
    ])(`${mode}: $name controls encoded JPEG quality`, async ({ args, quality }) => {
        const files = new Map<string, Uint8Array>([["in.ppm", input], ["in.jpg", jpeg]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const argv = [...args, "-write", "copy.jpg", "jpeg:-"];
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const copy = mode === "command" || mode === "retained" ? await fs.readFile("/copy.jpg") : files.get("copy.jpg")!;
        const stdout = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        for (const bytes of [copy, stdout]) {
            expect(decodeImage(bytes)).toMatchObject({ width: 8, height: 6, quality });
        }
    });
}
