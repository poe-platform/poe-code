import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGB8 and RGBA16 outputs.
for (const [space, green, palette, green16, alpha16] of [
    ["YIQ", "04fb0a", "04fb0abf335c", "038bfc3409cfffff", "038bfc3409cf8080"],
    ["YUV", "04fd00", "42b121eb0a77", "0454fdb80000ffff", "0454fdb800008080"],
    ["YDbDr", "53c841", "8e4c5c53c841", "52e5c90a4122ffff", "0000f349411f8080"],
    ["LCHuv", "36fd36", "a5af00f33079", "3612fe58360dffff", "000affff00008080"],
] as const) for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    for (const [name, inputs, options, expected, depth, format] of [
        ["spare palette capacity", ["xc:#00ff00"], ["-quantize", space, "+dither", "-colors", "3"], green, "8", "rgb"],
        ["two-color palette", ["-size", "1x1", "xc:#806642", "xc:#ff0077", "xc:#00ff00", "+append"], ["-quantize", space, "+dither", "-colors", "2", "-unique-colors"], palette, "8", "rgb"],
        ["in-range control", ["xc:#806642"], ["-quantize", space, "+dither", "-colors", "3"], "806642", "8", "rgb"],
        ["conversion control", ["xc:#00ff00"], ["-colorspace", space], "00ff00", "8", "rgb"],
        ["16-bit palette", ["xc:#00ff00"], ["-quantize", space, "+dither", "-colors", "3"], green16, "16", "rgba"],
        ["clipping after alpha association", ["xc:#00ff0080"], ["-quantize", space, "+dither", "-colors", "3"], alpha16, "16", "rgba"],
    ] as const) it(`${space} ${name} (${mode})`, async () => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = [...inputs, ...options, "-colorspace", "sRGB", "-depth", depth, "-endian", "MSB", `${format}:/out`];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const bytes = mode === "retained" || mode === "public" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
