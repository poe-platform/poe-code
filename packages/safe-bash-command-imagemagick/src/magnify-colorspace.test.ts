import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { magnifyPixelSteps } from "./magnify-kernel.js";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: magnification repeats these translucent
// pixels without changing their sRGB round trip.
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
    const steps = magnifyPixelSteps({ width, height: 1, space: "srgb", hasAlpha: true, hueSamples }, method, { r: 0, g: 0, b: 0, a: 255 });
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

// ImageMagick 7.1.2-35 Q16-HDRI converts these inputs before magnification.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const space of ["CMYK", "HSL", "sRGB"]) {
        it.each(["info", "raw"])(`${mode}: magnifies ${space} with native %s stdout`, async output => {
            const args = ["xc:#f0c814", "xc:#204090", "+append", "-colorspace", space, "-magnify",
                ...(output === "info" ? ["-format", "%[colorspace] %wx%h", "info:"]
                    : ["-depth", "8", space === "CMYK" ? "cmyk:-" : "rgb:-"])];
            const filesystem = new MemoryFileSystem();
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString(output === "info" ? "utf8" : "hex"); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(args, new Map())
                : await runConvertCli(args, mode === "buffered" ? new Map() : { filesystem, cwd: "/" });
            expect(result.exitCode, stderr).toBe(0);
            expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
                ? Buffer.from(result.stdoutBytes).toString(output === "info" ? "utf8" : "hex")
                : "stdout" in result ? result.stdout : stdout)
                .toBe(output === "info" ? "sRGB 4x2" : space === "CMYK"
                    ? "002bea0f002bea0fc68e006fc68e006f002bea0f002bea0fc68e006fc68e006f"
                    : "f0c814f0c814204090204090f0c814f0c814204090204090");
        });
    }
}

// Native retains RGB-compatible colorspaces, including linear and wide-gamut RGB.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(["RGB", "scRGB", "Gray", "LinearGray", "DisplayP3", "Adobe98", "ProPhoto"])(`${mode}: magnify preserves %s metadata`, async space => {
        const filesystem = new MemoryFileSystem();
        const args = ["xc:#f0c814", "xc:#204090", "+append", "-colorspace", space, "-magnify",
            "-format", "%[colorspace] %wx%h", "info:"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, new Map())
            : await runConvertCli(args, mode === "buffered" ? new Map() : { filesystem, cwd: "/" });
        expect(result.exitCode, stderr).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe(`${space} 4x2`);
    });
}
