import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, MSB raw RGB output.
const cases = [
    { name: "default black", operations: ["-sigmoidal-contrast", "5x40%", "-channel", "K", "-separate"], expected: "808080121212292929" },
    { name: "selected inverse black", operations: ["-channel", "K", "+sigmoidal-contrast", "5x40%", "+channel", "-channel", "K", "-separate"], expected: "6262621f1f1f343434" },
    { name: "converted RGB", operations: ["-sigmoidal-contrast", "5x40%", "-colorspace", "sRGB"], expected: "053c7f0695edccd625" },
    { name: "unadjusted black control", operations: ["-channel", "K", "-separate"], expected: "6e6e6e1818182f2f2f" },
    { name: "unadjusted RGB control", operations: ["-colorspace", "sRGB"], expected: "0f50911198e7c3d041" },
    { name: "selected forward black", operations: ["-channel", "K", "-sigmoidal-contrast", "5x40%", "-separate"], expected: "808080121212292929" },
    { name: "unselected black control", operations: ["-channel", "CMY", "-sigmoidal-contrast", "5x40%", "-channel", "K", "-separate"], expected: "6e6e6e1818182f2f2f" },
    { name: "black preserves alpha", operations: ["-alpha", "set", "-channel", "A", "-evaluate", "set", "50%", "-channel", "K", "-sigmoidal-contrast", "5x40%", "-channel", "A", "-separate"], expected: "808080808080808080" },
    { name: "alpha preserves black", operations: ["-alpha", "set", "-channel", "A", "-evaluate", "set", "50%", "-sigmoidal-contrast", "5x40%", "-channel", "K", "-separate"], expected: "6e6e6e1818182f2f2f" },
];

for (const mode of ["magick", "convert", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: adjusts CMYK inks for $name`, async ({ operations, expected }) => {
        const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/a.ppm", input], ["/out", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/a.ppm", input);
        await fs.writeFile("/out", keep);
        const argv = ["/a.ppm", "-colorspace", "CMYK", ...operations, "-endian", "MSB", "-depth", "8", "rgb:/out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const command = mode === "magick" || mode === "convert";
        const result = command ? await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = command || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
