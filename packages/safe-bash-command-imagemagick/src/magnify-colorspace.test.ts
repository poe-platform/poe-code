import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { magnifyPixelSteps } from "./magnify-kernel.js";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: magnification repeats these translucent
// pixels in the active colorspace without changing their sRGB round trip.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const space of ["HSL", "Lab", "XYZ", "sRGB", "CMYK"]) {
        it.each([1, 2, 3])(`${mode}: magnifies ${space} working pixels by %s`, async factor => {
            const files = new Map<string, Uint8Array>();
            const filesystem = new MemoryFileSystem();
            const args = ["xc:#204080c0", "xc:#a0403060", "+append", "-colorspace", space,
                ...(factor === 3 ? ["-define", "magnify:method=scale3x"] : []),
                ...(factor > 1 ? ["-magnify"] : []), "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, stderr).toBe(0);
            const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
            expect(Buffer.from(output).toString("hex")).toBe(("204080c0".repeat(factor) + "a0403060".repeat(factor)).repeat(factor));
        });
    }
}

// Exercise both sides of the bounded row reads without quantizing the
// working plane, including values outside the visible raster's range.
it.each(["scale2x", "scale3x"] as const)("%s retains working samples across row chunks", method => {
    const width = 1025, factor = method === "scale3x" ? 3 : 2;
    const pixel = [-0.125, 1.25, 0.375, 0.75];
    const hueSamples = Float64Array.from(Array.from({ length: width }, () => pixel).flat());
    const output = new Float64Array(width * factor * factor * 4);
    const steps = magnifyPixelSteps({ width, height: 1, hasAlpha: true, hueSamples }, method, { r: 0, g: 0, b: 0, a: 255 });
    let next = steps.next();
    while (!next.done) {
        const request = next.value;
        if (request?.kind === "read") {
            const samples = hueSamples.slice(request.position, request.position + request.length);
            next = steps.next(new Uint8Array(samples.buffer));
        } else {
            if (request?.hue) output.set(new Float64Array(request.data.slice().buffer), request.position);
            next = steps.next();
        }
    }
    expect(output).toEqual(Float64Array.from(Array.from({ length: width * factor * factor }, () => pixel).flat()));
});
