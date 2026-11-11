import { expect, it } from "vitest";
import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: P2, 3x2, samples 10 20 30 / 40 50 60.
// Native PNG bytes retain the storage class distinction despite identical pixels.
const inputs = [
    { name: "gray8.png", pixels: "1d29", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAAAAAC4HznGAAAAEElEQVQI12Pk4uJikePiAgABTABW+DZHBQAAAABJRU5ErkJggg==", "base64") },
    { name: "gray16.png", pixels: "1c2a", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACEAAAAADoj+WFAAAAFklEQVQI12Pk4uLi4uJikZPj4uLiAgAEXACm2kFFbQAAAABJRU5ErkJggg==", "base64") },
    { name: "rgb.png", pixels: "1c2a", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEUlEQVQI12PkggEWOTk5CAsACTgA9nAY21sAAAAASUVORK5CYII=", "base64") },
    { name: "palette.png", pixels: "1d29", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACBAMAAABvWnspAAAAElBMVEUKCgoUFBQeHh4oKCgyMjI8PDyHNRZ+AAAADklEQVQI12NgVGAwCQAAAUMApm7mwhAAAAAASUVORK5CYII=", "base64") },
    { name: "in.pgm", pixels: "1c2a", bytes: Buffer.from("P2\n3 2\n255\n10 20 30\n40 50 60\n") },
];

for (const mode of ["command", "buffered", "stored", "sync"] as const)
for (const operation of ["resize", "extract"] as const)
for (const filter of ["default", "Mitchell", "Lanczos"] as const) {
    it.each(inputs)(`${mode}: ${operation} with ${filter} preserves native pixels and geometry for $name`, async ({ name, bytes, pixels }) => {
        const input = `/${name}`, files = new Map<string, Uint8Array>([[input, bytes], ["/out.raw", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, data] of files) await filesystem.writeFile(path, data);
        const args = [
            ...(filter === "default" ? [] : ["-filter", filter]),
            ...(operation === "extract" ? ["-extract", "2x1", input] : [input, "-resize", "2x1"]),
            "-format", "%wx%h|%g", "-write", "info:", "-depth", "8", "gray:/out.raw",
        ];
        let result;
        if (mode === "command") {
            let stdout = "", stderr = "";
            const status = await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(data) { stdout += new TextDecoder().decode(data); } },
                stderr: { async write(data) { stderr += new TextDecoder().decode(data); } },
            });
            result = { ...status, stdout, stderr };
        } else result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "stored" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stdout: "2x1|2x1+0+0", stderr: "" });
        const output = mode === "stored" || mode === "command" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
        expect(Buffer.from(output).toString("hex")).toBe(filter === "default" ? pixels : filter === "Mitchell" ? "1d29" : "1c2a");
    });
}
