import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI area-scaling fixtures.
const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i * 7))]);
const mask = Buffer.concat([Buffer.from("P5\n4 3\n255\n"), Buffer.from([0,255,0,0,255,0,255,0,0,0,255,255])]);
const original = "00070eff151c23ff2a3138ff3f464dff545b62ff697077ff7e858cff939aa1ffa8afb6ffbdc4cbffd2d9e0ffe7eef5ff";
const averaged = "272e35ff51585fff979ea5ffc1c8cfff";
const attach = ["-write-mask", "/mask.pgm"];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "reduced", ops: [...attach, "-scale", "2x2!", "+write-mask"], width: 2, height: 2, expected: "000000ff".repeat(4) },
        { name: "mixed axes", ops: [...attach, "-scale", "5x1!", "+write-mask"], width: 5, height: 1, expected: "000000ff".repeat(5) },
        { name: "same size", ops: [...attach, "-scale", "4x3!", "+write-mask"], width: 4, height: 3, expected: original },
        { name: "unmasked", ops: ["-scale", "2x2!"], width: 2, height: 2, expected: averaged },
        { name: "cleared mask", ops: [...attach, "+write-mask", "-scale", "2x2!"], width: 2, height: 2, expected: averaged },
        { name: "active alpha", ops: ["-alpha", "on", ...attach, "-scale", "2x2!", "+write-mask"], width: 2, height: 2, expected: "00000000".repeat(4) },
        { name: "later edit", ops: [...attach, "-scale", "2x2!", "-negate", "+write-mask"], width: 2, height: 2, expected: "ffffffff".repeat(4) },
    ])(`${mode}: masked scale matches native for $name`, async ({ ops, width, height, expected }) => {
        const files = new Map([["/input.ppm", input], ["/mask.pgm", mask]]), filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        await filesystem.writeFile("/out.png", new TextEncoder().encode("KEEP"));
        files.set("/out.png", Buffer.from("KEEP"));
        const args = ["/input.ppm", ...ops, "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(Buffer.from(output.data).toString("hex")).toBe(expected);
    });
}

for (const retained of [false, true]) {
    it(`preserves masked scale depth across pixel chunks (retained=${retained})`, async () => {
        const data16 = Uint16Array.from({ length: 48 }, (_, i) => i % 4 === 3 ? 65535 : (Math.floor(i / 4) * 3 + i % 4) * 7 * 257);
        const bytes = encodeImage({ width: 4, height: 3, format: "png", space: "srgb", channels: 3, depth: "ushort", density: 72, hasAlpha: false, data: Uint8Array.from(data16, value => value / 257), data16 }, { format: "png" }).data;
        const files = new Map([["/input.png", bytes], ["/mask.pgm", mask]]), filesystem = new MemoryFileSystem();
        for (const [path, data] of files) await filesystem.writeFile(path, data);
        const result = await runConvertCli(["/input.png", ...attach, "-scale", "2051x2!", "+write-mask", "-depth", "16", "PNG64:/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([2051, 2]);
        expect(output.data16).toEqual(Uint16Array.from({ length: 2051 * 2 * 4 }, (_, i) => i % 4 === 3 ? 65535 : 0));
    });
}
