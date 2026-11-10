import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const inputs = ["xc:#b03010", "xc:#302010", "xc:#505080", "xc:#a07070", "xc:#d0d020", "+append"];
// Native ImageMagick 7.1.2-35 Q16-HDRI, including the default and grayscale controls.
for (const [space, output, expected] of [
    ["RGB", "rgba", "391219ff391219ff391219ff391219ffa1a104ff"],
    ["Lab", "rgba", "6d2c11ff6d2c11ff6d2c11ff9b8466ff9b8466ff"],
    ["Lab", "info", "PseudoClass CIELab |2"],
    ["HSL", "rgba", "8c5a1aff8c5a1aff5e925eff5e925eff8c5a1aff"],
    ["CMYK", "info", "PseudoClass CMYK |1"],
    ["sRGB", "rgba", "a85040ff706b3bff706b3bffa85040ffa85040ff"],
    ["Gray", "rgba", "000000ff000000ff000000ff000000ffffffffff"],
]) for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it(`quantizes in ${space} before ${output} output (${mode})`, async () => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/out", Buffer.from("KEEP")]]);
        await filesystem.writeFile("/out", Buffer.from("KEEP"));
        const argv = [...inputs, "-quantize", space!, "+dither", "-colors", "2", ...(output === "info" ? ["-format", "%r|%k"] : ["-depth", "8"]), `${output}:/out`];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        const bytes = mode === "retained" || mode === "public" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString(output === "info" ? "utf8" : "hex")).toBe(expected);
    });
}

for (const retained of [false, true]) {
    it(`applies the colorspace setting only to subsequent reductions (retained=${retained})`, async () => {
        for (const options of [
            ["-quantize", "Lab", "+quantize", "-colors", "2"],
            ["-quantize", "HSL", "-quantize", "sRGB", "-colors", "2"],
            ["-colors", "2", "-quantize", "CMYK"],
        ]) {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const result = await runMagickCli([...inputs, "+dither", ...options, "-depth", "8", "rgba:/out"], retained ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const bytes = retained ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(bytes).toString("hex")).toBe("a85040ff706b3bff706b3bffa85040ffa85040ff");
        }
    });

    it(`preserves Lab palette samples across raster chunks and later conversion (retained=${retained})`, async () => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const argv = [...inputs, "-scale", "1025x1!", "-quantize", "lAb", "+dither", "-colors", "2", "-depth", "8", "-colorspace", "sRGB", "rgba:/out"];
        const result = await runMagickCli(argv, retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const bytes = retained ? await filesystem.readFile("/out") : files.get("/out")!;
        const expected = ["6d2c11ff", "6d2c11ff", "6d2c11ff", "9b8466ff", "9b8466ff"].map(pixel => pixel.repeat(205)).join("");
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
