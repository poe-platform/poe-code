import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { settings: ["-interpolate", "nearest-neighbor"], row: [255, 130, 40, 70, 255, 255] },
        { settings: ["-interpolate", "nearest"], row: [255, 130, 40, 70, 255, 255] },
        { settings: [], row: [248, 115, 73, 96, 202, 255] },
        { settings: ["-interpolate", "nearest-neighbor", "+interpolate"], row: [248, 115, 73, 96, 202, 255] },
    ])(`matches native point-filter rotation via ${mode}: $settings`, async ({ settings, row }) => {
        const pixels = Uint8Array.from([10, 40, 70, 100, 130, 160, 190, 220].flatMap(value => [value, value, value]));
        const input = await sharp(pixels, { raw: { width: 4, height: 2, channels: 3 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", ...settings, "-filter", "point", "-rotate", "30", "out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        expect(stderr).toBe("");
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([6, 6]);
        expect(Array.from(output.data.slice(2 * 6 * 4, 3 * 6 * 4))).toEqual(row.flatMap(value => [value, value, value, 255]));
        if (row[1] === 130) {
            // Native ImageMagick 7 Q16-HDRI, including background and untouched samples.
            const expected = [
                255, 255, 255, 255, 255, 255,
                255, 255, 255, 255, 255, 255,
                255, 130, 40, 70, 255, 255,
                255, 255, 160, 190, 100, 255,
                255, 255, 255, 255, 255, 255,
                255, 255, 255, 255, 255, 255,
            ];
            expect([...output.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
        }
    });
}

// ImageMagick 7.1.2-35 Q16-HDRI, SHA-256 of the raw RGB8 output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["blend", "e78f5e4bbc4ad6550d50def80e23259f6b5ebd736af80f0408601954631fc66e"],
        ["mesh", "027210bed0bce0cc3db231fa00796e815c7e9345081809c1318b6135e9456b2d"],
        ["catrom", "81e553d4179e79a0fc12bbb076a3be6d4d18a2f590d42694271fadca1f98a92e"],
        ["spline", "de42d3f82142521ef18ca67590ec0d1b148719c9f20c1107618c81903a4661a7"],
        ["bilinear", "53cf6d9aeb3cb221737f11e810367abfa081e43e5f1dc6d80f090b59b9f9307e"],
        ["nearest", "29a367c5b8ba6546f578c9b798783b6fb54205347565b64fd06c655a5d63c9f3"],
    ])(`matches native %s Point rotation on a positioned page (${mode})`, async (method, hash) => {
        const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from("ff000000ff000000ff804020c0ffee231337", "hex")]);
        const files = new Map([["/in.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in.ppm", "-repage", "9x8+4+3", "-filter", "point", "-interpolate", method, "-rotate", "30", "-depth", "8", "rgb:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output).toHaveLength(5 * 6 * 3);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
