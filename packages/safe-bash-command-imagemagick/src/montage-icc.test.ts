import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";
import fixtures from "./montage-icc-fixtures.json" with { type: "json" };

// LittleCMS sRGB/Lab profiles; pixels and PNG chunks verified with ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
    async function run(args: string[]) {
        const files = new Map(Object.entries(fixtures).map(([name, bytes]) => [name, new Uint8Array(Buffer.from(bytes, "base64"))]));
        files.set("bad.icc", Uint8Array.of(1, 2, 3));
        const malformed = files.get("lab.icc")!.slice();
        new DataView(malformed.buffer).setUint32(136, 0xffffffff);
        files.set("malformed.icc", malformed);
        files.set("existing.png", Uint8Array.of(42));
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        let result;
        if (mode === "magick" || mode === "montage") {
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
            const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
            const executed = await command.execute({
                command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            result = { exitCode: executed.exitCode, stderr, stdoutBytes: Buffer.concat(chunks) };
        } else result = mode === "sync" ? runMontageCliSync(args, files)
            : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        return { ...result, existing: mode === "buffered" || mode === "sync" ? files.get("existing.png") : await fs.readFile("/existing.png") };
    }

    it.each([
        { options: [], pixel: "ff0000ff" },
        { options: ["-strip"], pixel: "ff0000ff" },
        { options: ["-strip", "-profile", "lab.icc"], pixel: "ff0000ff" },
        { options: ["+profile", "icc", "-profile", "lab.icc"], pixel: "ff0000ff" },
        { options: ["+profile", "*", "-profile", "lab.icc"], pixel: "ff0000ff" },
        { options: ["-profile", "lab.icc"], pixel: "8a5146ff" },
        { options: ["+profile", "xmp", "-profile", "lab.icc"], pixel: "8a5146ff" },
        { options: ["-profile", "lab.icc", "-strip"], pixel: "8a5146ff" },
        { options: ["-profile", "lab.icc", "-profile", "srgb.icc"], pixel: "ff0000ff" }
    ])(`applies source profiles in order (${mode}): $options`, async ({ options, pixel }) => {
        const result = await run(["tile.png", "tile.png", "-tile", "2x1", "-geometry", "+0+0", ...options, "png24:-"]);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const bytes = result.stdoutBytes!;
        const image = decodeImage(bytes);
        expect([image.width, image.height]).toEqual([2, 1]);
        expect(Buffer.from(image.data).toString("hex")).toBe(pixel.repeat(2));
        expect(image.icc).toBeUndefined();
        const chunks = new Map<string, Buffer>();
        const png = Buffer.from(bytes);
        for (let offset = 8; offset < png.length;) {
            const length = png.readUInt32BE(offset);
            chunks.set(png.toString("ascii", offset + 4, offset + 8), png.subarray(offset + 8, offset + 8 + length));
            offset += length + 12;
        }
        expect(chunks.get("cHRM")).toEqual(Buffer.from("00007a26000080840000fa00000080e8000075300000ea6000003a9800001770", "hex"));
        expect(chunks.get("bKGD")).toEqual(Buffer.from("00ff00ff00ff", "hex"));
    });

    it(`converts profiles supplied before input filenames (${mode})`, async () => {
        const result = await run(["-profile", "lab.icc", "tile.png", "tile.png", "-tile", "2x1", "-geometry", "+0+0", "png24:-"]);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Buffer.from(decodeImage(result.stdoutBytes!).data).toString("hex")).toBe("8a5146ff8a5146ff");
    });

    it(`scopes removal to a parenthesized input (${mode})`, async () => {
        const result = await run(["(", "tile.png", "-strip", ")", "tile.png", "-profile", "lab.icc", "-tile", "2x1", "-geometry", "+0+0", "png24:-"]);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Buffer.from(decodeImage(result.stdoutBytes!).data).toString("hex")).toBe("ff0000ff8a5146ff");
    });

    it.each(["missing.icc", "bad.icc", "malformed.icc"])(`preserves output when profile %s fails (${mode})`, async profile => {
        const result = await run(["tile.png", "-profile", profile, "existing.png"]);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(profile === "malformed.icc" ? "invalid or unsupported ICC" : profile);
        expect(result.existing).toEqual(Uint8Array.of(42));
        expect(result.stdoutBytes?.length ?? 0).toBe(0);
    });

    it.each(["-profile", "+profile"])(`requires a profile argument for %s (${mode})`, async option => {
        const result = await run(["tile.png", option]);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(`missing argument for ${option}`);
    });
}
