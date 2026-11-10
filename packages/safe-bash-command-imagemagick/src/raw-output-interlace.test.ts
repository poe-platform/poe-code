import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = sharp(Uint8Array.from({ length: 36 }, (_, i) => 7 * i + 1), { raw: { width: 3, height: 4, channels: 3 } }).png().toBufferSync();
// ImageMagick 7.1.2-35, PNG24 input followed by -depth 8 -interlace <mode> out.rgb.
const layouts = {
    Plane: "01162b40556a7f94a9bed3e8081d32475c71869bb0c5daef0f24394e63788da2b7cce1f6",
    Line: "01162b081d320f243940556a475c714e63787f94a9869bb08da2b7bed3e8c5daefcce1f6",
    None: "01080f161d242b323940474e555c636a71787f868d949ba2a9b0b7bec5ccd3dae1e8eff6"
};

for (const mode of ["sync", "buffered", "command"] as const) {
    it.each(["Plane", "Line", "None", "default", "reset"] as const)(`writes native RGB layouts (${mode}, %s)`, async interlace => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.png", input], ["/out.rgb", keep], ["/copy.bin", keep]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const options = interlace === "default" ? [] : interlace === "reset" ? ["-interlace", "Plane", "+interlace"] : ["-interlace", interlace];
        const args = ["/in.png", "-depth", "8", ...options, "-write", "RGB:/copy.bin", "/out.rgb"];
        let stderr = "";
        const result = mode === "sync" ? runConvertCliSync(args, files) : mode === "buffered" ? await runConvertCli(args, files) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect(result.exitCode, stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        for (const path of ["/copy.bin", "/out.rgb"]) {
            const bytes = mode === "command" ? await fs.readFile(path) : files.get(path)!;
            expect(Buffer.from(bytes).toString("hex")).toBe(layouts[interlace === "default" || interlace === "reset" ? "None" : interlace]);
        }
    });
}

for (const mode of ["sync", "retained"] as const) {
    it(`captures interlace at each intermediate write (${mode})`, async () => {
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const args = ["/in.png", "-depth", "8", "-interlace", "pLaNe", "-write", "/plane-%d.rgb", "-interlace", "lInE", "-write", "/line-%d.rgb", "-interlace", "None", "-write", "/none.rgb", "-interlace", "Line", "+interlace", "rgb:-"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        for (const [path, layout] of [["/plane-0.rgb", "Plane"], ["/line-0.rgb", "Line"], ["/none.rgb", "None"]] as const) {
            const bytes = mode === "sync" ? files.get(path)! : await fs.readFile(path);
            expect(Buffer.from(bytes).toString("hex")).toBe(layouts[layout]);
        }
        expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(layouts.None);
    });

    for (const interlace of ["Plane", "Line"] as const) {
        it.each([8, 16])(`preserves samples across row and storage boundaries (${mode}, ${interlace}, depth=%s)`, async depth => {
            const width = 4103, height = 2, sampleBytes = depth / 8;
            const pixels = Uint8Array.from({ length: width * height * 3 * sampleBytes }, (_, i) => (i * 43 + 19) % 256);
            const ppm = Buffer.concat([Buffer.from(`P6\n${width} ${height}\n${depth === 8 ? 255 : 65535}\n`), pixels]);
            const files = new Map([["/in.ppm", ppm as Uint8Array]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", ppm);
            const args = ["/in.ppm", "-depth", String(depth), "-interlace", interlace, "-endian", "MSB", "-write", "/msb.rgb", "-endian", "LSB", "/lsb.rgb"];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, { filesystem: fs, cwd: "/" });
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            const expected: number[] = [];
            const rows = interlace === "Line" ? height : 1, rowPixels = width * height / rows;
            for (let row = 0; row < rows; row++) for (let channel = 0; channel < 3; channel++) {
                for (let pixel = row * rowPixels; pixel < (row + 1) * rowPixels; pixel++) {
                    const offset = (pixel * 3 + channel) * sampleBytes;
                    expected.push(...pixels.subarray(offset, offset + sampleBytes));
                }
            }
            const msb = mode === "sync" ? files.get("/msb.rgb")! : await fs.readFile("/msb.rgb");
            const lsb = mode === "sync" ? files.get("/lsb.rgb")! : await fs.readFile("/lsb.rgb");
            expect(msb).toEqual(Uint8Array.from(expected));
            expect(lsb).toEqual(new Uint8Array(depth === 16 ? Buffer.from(expected).swap16() : expected));
        });
    }
}

for (const mode of ["sync", "retained"] as const) {
    it.each([
        ["rgb", "123456abcdef"],
        ["rgba", "12345680abcdef40"],
        ["bgr", "563412efcdab"],
        ["bgra", "56341280efcdab40"],
        ["gray", "2fc8"]
    ])(`preserves packed raw channel selection (${mode}, %s)`, async (coder, hex) => {
        const png = sharp(Buffer.from("12345680abcdef40", "hex"), { raw: { width: 2, height: 1, channels: 4 } }).png().toBufferSync();
        const files = new Map([["/in.png", png]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", png);
        const args = ["/in.png", `${coder}:-`];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(hex);
    });
}
