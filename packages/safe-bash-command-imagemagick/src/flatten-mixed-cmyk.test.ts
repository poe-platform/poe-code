import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: composite native channels even when layer spaces differ.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const operation of [["-flatten"], ["-layers", "flatten"], ["-mosaic"], ["-layers", "mosaic"], ["-layers", "merge"]])
it.each([
    { base: "sRGB", top: "CMYK", compose: "Copy", hex: "0080d3400000000000000000", pixel: "sRGB srgba(0%,50%,82.7586%,0.25098)" },
    { base: "sRGB", top: "CMYK", compose: "Src", hex: "0080d3400000000000000000" },
    { base: "CMYK", top: "sRGB", compose: "Copy", hex: "178bd7400000000000000000", pixel: "CMYK cmyka(232,116,40,0,0.25098)" },
    { base: "CMYK", top: "sRGB", compose: "Src", hex: "178bd7400000000000000000" },
    { base: "sRGB", top: "CMYK", compose: "Multiply", hex: "0b3e6ca00000000000000000" },
    { base: "sRGB", top: "CMYK", compose: "Over", hex: "0b5288a00000000000000000" },
    { base: "sRGB", top: "sRGB", compose: "Copy", hex: "e87428400000000000000000" }
])(`${mode} ${operation.join(" ")}: $base below $top with $compose`, async ({ base, top, compose, hex, pixel }) => {
    for (const output of pixel ? ["rgba", "info"] : ["rgba"]) {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments([
            "(", "xc:#12345680", "-colorspace", base, "-repage", "3x1+0+0", ")",
            "(", "xc:#e8742840", "-colorspace", top, "-repage", "3x1+0+0", ")",
            "-background", "none", "-compose", compose, ...operation,
            ...(output === "info" ? ["-format", "%[colorspace] %[pixel:u]", "info:/out"]
                : ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"])
        ]);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(args.args, files)
            : await runConvertCli(args.args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, JSON.stringify(result)).toBe(0);
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString(output === "info" ? "utf8" : "hex")).toBe(output === "info" ? pixel : operation[1] === "merge" ? hex.slice(0, 8) : hex);
    }
});
