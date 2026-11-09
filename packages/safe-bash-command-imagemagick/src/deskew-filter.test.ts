import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

it.each(["buffered", "retained", "sync", "mogrify"])("honors Point filtering during deskew (%s)", async mode => {
    const width = 96, height = 48, data = new Uint8Array(width * height * 4).fill(255);
    for (let x = 8; x <= 80; x++) for (const baseline of [8, 18, 28]) {
        for (let y = Math.ceil(baseline + (x - 8) / 18); y <= Math.floor(baseline + 3 + (x - 8) / 18); y++) {
            data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
        }
    }
    const input = encodeImage({ width, height, data, format: "png", density: 72, channels: 3, hasAlpha: false, space: "srgb", depth: "uchar" }, { format: "png" }).data;
    const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const options = ["-filter", "Point", "-deskew", "40%"];
    const args = ["/input.png", ...options, "png:-"];
    const result = mode === "mogrify" ? await runMogrifyCli([...options, "/input.png"], files)
        : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const actual = decodeImage(mode === "mogrify" ? files.get("/input.png")! : result.stdoutBytes!);
    const defaultResult = runConvertCliSync(["/input.png", "-deskew", "40%", "png:-"], new Map([["/input.png", input]]));
    expect(actual.data).not.toEqual(decodeImage(defaultResult.stdoutBytes!).data);
    const reference = spawnSync("magick", ["-", ...options, "-depth", "8", "png:-"], { input });
    if (!reference.error) {
        expect(reference.status, reference.stderr.toString()).toBe(0);
        const expected = decodeImage(reference.stdout);
        expect([actual.width, actual.height, actual.virtualCanvas]).toEqual([expected.width, expected.height, expected.virtualCanvas]);
        expect(Math.max(...actual.data.map((value, i) => Math.abs(value - expected.data[i]!)))).toBeLessThanOrEqual(1);
    }
});

// ImageMagick 7.1.2-35 Q16-HDRI: input -filter FILTER [-define filter:blur=1.5]
// -deskew 40% -depth 8 PNG32:expected.png.
for (const [name, options] of [
    ["lanczos", ["-filter", "Lanczos"]],
    ["triangle", ["-filter", "Triangle"]],
    ["box", ["-filter", "Box"]],
    ["blur", ["-filter", "Lanczos", "-define", "filter:blur=1.5"]]
] as const) {
    it.each(["buffered", "retained", "sync", "mogrify", "magick"])(`matches native deskew with ${options.join(" ")} (%s)`, async mode => {
        const input = readFileSync(new URL("./fixtures/deskew-filter.png", import.meta.url));
        const expected = decodeImage(readFileSync(new URL(`./fixtures/deskew-filter-${name}.png`, import.meta.url)));
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", ...options, "-deskew", "40%", "PNG32:/output.png"];
        let stderr = "";
        const result = mode === "magick" ? { ...await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stderr } : mode === "mogrify" ? await runMogrifyCli([...options, "-deskew", "40%", "/input.png"], files)
            : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const actual = decodeImage(mode === "mogrify" ? files.get("/input.png")!
            : mode === "retained" || mode === "magick" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
        expect([actual.width, actual.height, actual.virtualCanvas]).toEqual([expected.width, expected.height, expected.virtualCanvas]);
        expect(actual.data.reduce((count, value, i) => count + Number(value !== expected.data[i]), 0)).toBe(0);
    });
}
