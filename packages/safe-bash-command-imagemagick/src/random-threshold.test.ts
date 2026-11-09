import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./random-threshold-fixtures.json" with { type: "json" };

// Native ImageMagick 7.1.2-31 Q16-HDRI, MAGICK_THREAD_LIMIT=1, RGBA output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(fixtures)(`${mode}: random threshold $name`, async ({ depth, values, alpha, options, expected }) => {
        const samples = values.flatMap(value => [value, value, value, alpha ? value : 2 ** depth - 1]);
        const input = encodeImage({ width: values.length, height: 1, data: Uint8Array.from(samples, value => depth === 16 ? Math.round(value / 257) : value),
            ...(depth === 16 ? { data16: Uint16Array.from(samples) } : {}), format: "png", space: "srgb", channels: alpha ? 4 : 3, depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha: alpha }, { format: "png", pngCoder: depth === 16 ? "png64" : "png32" }).data;
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["/in.png", ...options, ...(alpha ? ["-channel", "A", "-separate"] : []), "-depth", String(depth), depth === 16 ? "PNG64:/out.png" : "PNG32:/out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        const output = decodeImage(bytes);
        const actual = depth === 16 ? Array.from(output.data16!).map(value => value.toString(16).padStart(4, "0")).join("") : Buffer.from(output.data).toString("hex");
        // Extract alpha to inspect it independently of transparent RGB output normalization.
        const expectedPixels = alpha ? Array.from(Buffer.from(expected, "hex")).filter((_, index) => index % 4 === 3).map(value => value.toString(16).padStart(2, "0").repeat(3) + "ff").join("") : expected;
        expect(actual).toBe(expectedPixels);
    });
}

it.each(["", "25xno%", "NaN", "10x20x30", "Infinity"])("rejects invalid random threshold %s without overwriting output", range => {
    const original = new Uint8Array([1, 2, 3]);
    const files = new Map([["out.png", original]]);
    expect(runConvertCliSync(["xc:red", "-random-threshold", range, "out.png"], files).exitCode).not.toBe(0);
    expect(files.get("out.png")).toBe(original);
});

it("preserves the native seeded stream across rows and stored chunks", async () => {
    const data = Uint8Array.from({ length: 1031 * 2 * 4 }, (_, offset) =>
        (Math.floor(offset / 4) * [37, 91, 53, 29][offset % 4]! + 17) % 256);
    const input = encodeImage({ width: 1031, height: 2, data, format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png", pngCoder: "png32" }).data;
    const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    for (const backend of [files, { filesystem, cwd: "/" }]) {
        expect(await runConvertCli(["/in.png", "-seed", "17", "-random-threshold", "25x75%", "PNG32:/out.png"], backend)).toMatchObject({ exitCode: 0 });
        const output = decodeImage(backend === files ? files.get("/out.png")! : await filesystem.readFile("/out.png"));
        expect(createHash("sha256").update(output.data).digest("hex")).toBe("c4b531639e5d67698eb7e25af8ad03324e1ced80f840ee4209d6a03fde2ec64a");
    }
});
