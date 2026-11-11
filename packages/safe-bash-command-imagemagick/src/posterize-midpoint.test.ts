import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    // ImageMagick 7.1.2-35 Q16-HDRI reference bytes (big-endian).
    it.each([
        { levels: 3, dither: [], depth: 16, hex: "8000" },
        { levels: 5, dither: [], depth: 16, hex: "8000" },
        { levels: 3, dither: ["-dither", "FloydSteinberg"], depth: 16, hex: "8000" },
        { levels: 3, dither: ["+dither"], depth: 16, hex: "8000" },
        { levels: 3, dither: [], depth: 8, hex: "80" },
        { levels: 4, dither: [], depth: 16, hex: "aaaa" },
    ])(`${mode}: preserves posterize $levels midpoint, $dither depth $depth`, async ({ levels, dither, depth, hex }) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argv = ["xc:#808080", ...dither, "-posterize", String(levels), "-depth", String(depth), "-endian", "MSB", "gray:out.gray"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" },
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.gray") : files.get("out.gray")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["FloydSteinberg", 5, "xc:#109477", "008040ff"],
        ["Riemersma", 5, "xc:#109477", "008040ff"],
        ["None", 5, "xc:#109477", "008080ff"],
        ["FloydSteinberg", 3, "/in.ppm", "008080ff807f00ff7f807fffff7f80ff"],
        ["None", 3, "/in.ppm", "008080ff808000ff800080ffff8080ff"],
        ["FloydSteinberg", 3, "xc:#808080", "808080ff7f7f7fff808080ff7f7f7fff".repeat(2)],
    ] as const)(`${mode}: native %s posterize %i of %s`, async (dither, levels, input, expected) => {
        const ppm = Buffer.from("50360a3420310a3235350a10947765ab31773e9ed56690", "hex");
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/in.ppm", ppm]]);
        await fs.writeFile("/in.ppm", ppm);
        const argv = ["-seed", "42", ...(input === "xc:#808080" ? ["-size", "4x2"] : []), input, "-dither", dither, "-posterize", String(levels), "-depth", "8", "rgba:/out.rgba"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.rgba") : files.get("/out.rgba")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
