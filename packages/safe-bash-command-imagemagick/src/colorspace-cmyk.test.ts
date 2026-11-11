import { encodeImage, decodeImage } from "@poe-code/image-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const retained of [false, true]) {
    it.each(["CMYK", "cmyk"])(`rejects JPEG-compressed %s TIFF without overwriting output, retained=${retained}`, async space => {
        const fs = new MemoryFileSystem();
        const original = new Uint8Array([1, 2, 3]);
        const files = new Map<string, Uint8Array>([["out.tiff", original]]);
        await fs.writeFile("/out.tiff", original);
        const result = await runConvertCli(["-size", "2x1", "xc:red", "-colorspace", space, "-compress", "JPEG", "out.tiff"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("CMYK TIFF does not support JPEG compression");
        expect(result.stdout).toBe("");
        expect(retained ? await fs.readFile("/out.tiff") : files.get("out.tiff")).toEqual(original);
    });
}

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
it.skipIf(!nativeAvailable)("writes the native CMYK TIFF workflow with separated samples", async () => {
    const input = spawnSync("magick", ["-size", "2x1", "xc:red", "-fill", "blue", "-draw", "point 1,0", "PNG24:-"]);
    expect(input.status).toBe(0);
    const native = spawnSync("magick", ["png:-", "-colorspace", "CMYK", "tiff:-"], { input: input.stdout });
    expect(native.status).toBe(0);
    const metadata = spawnSync("magick", ["identify", "-format", "%[colorspace] %[channels]", "tiff:-"], { input: native.stdout, encoding: "utf8" });
    expect(metadata.status).toBe(0);
    expect(metadata.stdout.trim()).toBe("CMYK cmyk  4.0");
    for (const retained of [false, true]) {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const result = await runConvertCli(["png:-", "-colorspace", "CMYK", "tiff:-"], retained ? { filesystem: fs, cwd: "/" } : files, input.stdout);
        expect(result.exitCode, result.stderr).toBe(0);
        const decoded = spawnSync("magick", ["tiff:-", "-depth", "8", "cmyk:-"], { input: result.stdoutBytes! });
        expect(decoded.status, decoded.stderr.toString()).toBe(0);
        expect(Array.from(decoded.stdout)).toEqual([0, 255, 255, 0, 255, 255, 0, 0]);
    }
});

for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`inspects working CMYK pixels and connected components, ${mode}`, async () => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const run = (args: string[]) => mode === "sync" ? runConvertCliSync(args, files) : runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        // Drawing activates alpha; explicitly disable it for these four-channel CMYK checks.
        const input = ["-size", "3x2", "xc:red", "-fill", "blue", "-draw", "point 0,0", "-alpha", "off", "-colorspace", "CMYK"];
        const pixels = await run([...input, "-format", "%[colorspace] %[pixel:p{0,0}] %[pixel:p{1,0}]", "info:"]);
        expect(pixels.exitCode, pixels.stderr).toBe(0);
        expect(pixels.stdout.trim()).toBe("CMYK cmyk(255,255,0,0) cmyk(0,255,255,0)");
        const components = await run([...input, "-define", "connected-components:verbose=true", "-connected-components", "4", "null:"]);
        expect(components.exitCode, components.stderr).toBe(0);
        expect(components.stdout).toContain("cmyk(255,255,0,0)");
        expect(components.stdout).toContain("cmyk(0,255,255,0)");
        const neutral = await run(["-size", "2x1", "xc:black", "-fill", "white", "-draw", "point 1,0", "-alpha", "off", "-colorspace", "CMYK", "-define", "connected-components:verbose=true", "-connected-components", "4", "null:"]);
        expect(neutral.exitCode, neutral.stderr).toBe(0);
        expect(neutral.stdout).toContain("cmyk(0,0,0,255)");
        expect(neutral.stdout).toContain("cmyk(0,0,0,0)");
        const roundtrip = await run([...input, "-colorspace", "CMYK", "-colorspace", "sRGB", "-format", "%[colorspace] %[pixel:p{0,0}]", "info:"]);
        expect(roundtrip.stdout.trim()).toBe("sRGB srgb(0,0,255)");
    });
}

for (const retained of [false, true]) {
    it(`preserves black, fractional ink, alpha and RGB codec output, retained=${retained}`, async () => {
        const pixels = Uint8Array.of(32, 64, 96, 128, 0, 0, 0, 255);
        const { data } = encodeImage({ width: 2, height: 1, data: pixels, format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" });
        const files = new Map([["/in.png", data]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", data);
        const input = retained ? { filesystem: fs, cwd: "/" } : files;
        const result = await runConvertCli(["/in.png", "-colorspace", "CMYK", "-write", "/out.png", "-format", "%[channels] %[pixel:p{0,0}] %[pixel:p{1,0}] %[fx:k] %[fx:p{1,0}.k]", "info:"], input);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout.trim()).toBe("cmyka 5.0 cmyka(170,85,0,159,0.501961) cmyka(0,0,0,255,1) 0.623529 1");
        expect(decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!).data).toEqual(pixels);
        const linear = await runConvertCli(["/in.png", "-colorspace", "CMYK", "-colorspace", "RGB", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:/roundtrip"], input);
        expect(linear.exitCode, linear.stderr).toBe(0);
        expect(Buffer.from(retained ? await fs.readFile("/roundtrip") : files.get("/roundtrip")!).toString("hex")).toBe("2020404060608080000000000000ffff");
    });
}

it("converts PNG pixels through the public magick command on a fresh filesystem", async () => {
    const { data } = encodeImage({ width: 3, height: 2, data: Uint8Array.of(0, 0, 255, 255, ...Array(5).fill([255, 0, 0, 255]).flat()), format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" });
    const fs = new MemoryFileSystem();
    await fs.writeFile("/b.png", data);
    const args = ["b.png", "-colorspace", "CMYK", "-format", "%[colorspace] %[pixel:p{0,0}] %[pixel:p{1,0}]", "info:"];
    let stdout = "", stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async chunk => { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
    });
    expect(result.exitCode, stderr).toBe(0);
    expect(stdout.trim()).toBe("CMYK cmyk(255,255,0,0) cmyk(0,255,255,0)");
    if (nativeAvailable) {
        const native = spawnSync("magick", ["png:-", ...args.slice(1)], { input: data });
        expect(native.status).toBe(0);
        expect(stdout.trim()).toBe(native.stdout.toString().trim());
    }
});
