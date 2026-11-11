import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    // ImageMagick 7.1.2-35 Q16-HDRI (aarch64) reference RGBA8 bytes.
    it.each([
        ...["Riemersma", "FloydSteinberg"].flatMap(dither => [
            { color: "#109477", mask: ["-write-mask", "xc:gray50"], dither, levels: 2, hex: "04e41eff" },
            { color: "#109477", mask: ["-write-mask", "xc:white"], dither, levels: 2, hex: "109477ff" },
            { color: "#109477", mask: ["-write-mask", "xc:black"], dither, levels: 2, hex: "00ff00ff" },
        ]),
        { color: "#109477", mask: ["-write-mask", "xc:gray50"], dither: "None", levels: 2, hex: "08ca3bff" },
        { color: "#10947780", mask: ["-write-mask", "xc:gray50"], dither: "Riemersma", levels: 2, hex: "01090780" },
        { color: "#65ab31", mask: ["-write-mask", "xc:gray25"], dither: "Riemersma", levels: 2, hex: "06fa03ff" },
        { color: "#65ab31", mask: ["-write-mask", "xc:gray75"], dither: "Riemersma", levels: 2, hex: "39d01bff" },
        ...[["-region", "1x1+0+0"], ["-write-mask", "xc:black"]].map(mask => ({ color: "#65ab31", mask, dither: "Riemersma", levels: 4, hex: "55aa55ff" })),
        { color: "#65ab31", mask: [], dither: "Riemersma", levels: 4, hex: "55aa55ff" },
        { color: "#65ab31", mask: ["-region", "1x1+0+0"], dither: "None", levels: 4, hex: "55aa55ff" },
    ])(`${mode}: posterize $color with $mask, $dither`, async ({ color, mask, dither, levels, hex }) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argv = ["-seed", "42", `xc:${color}`, ...mask, "-dither", dither, "-posterize", String(levels), "+write-mask", "-depth", "8", "rgba:out.rgba"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" },
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.rgba") : files.get("out.rgba")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
