import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, with -limit memory 0 -limit map 0.
// Native heap caches read uninitialized mask/alpha samples when splice activates
// alpha: MALLOC_PERTURB_ changes the inserted row. A fresh disk cache gives these
// stable reference pixels without preserving allocator-dependent garbage.
const cases = [
    { name: "masked sRGB row after Off", alpha: "Off", space: "sRGB", mask: true, geometry: "0x1+0+1", hex: "4080c0ff4080c0ff20402040204020404080c0ff4080c0ff" },
    { name: "masked Lab row after Off", alpha: "Off", space: "Lab", mask: true, geometry: "0x1+0+1", hex: "4080c0ff4080c0ff0091d6400091d6404080c0ff4080c0ff" },
    { name: "alpha On control", alpha: "On", space: "sRGB", mask: true, geometry: "0x1+0+1", hex: "4080c0804080c08020402040204020404080c0804080c080" },
    { name: "unmasked control", alpha: "Off", space: "sRGB", mask: false, geometry: "0x1+0+1", hex: "4080c0ff4080c0ff20402040204020404080c0ff4080c0ff" },
    { name: "column control", alpha: "Off", space: "sRGB", mask: true, geometry: "1x0+1+0", hex: "4080c0ff000000004080c0ff4080c0ff000000004080c0ff" }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: preserves initialized splice pixels for $name`, async ({ alpha, space, mask, geometry, hex }) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const args = ["-size", "2x2", "xc:#4080c080", "-alpha", alpha, "-colorspace", space,
            "-background", "#20402040", ...(mask ? ["-write-mask", "xc:black"] : []),
            "-splice", geometry, "+region", "+write-mask", "+read-mask", "-colorspace", "sRGB",
            "-depth", "8", mode === "command" ? "rgba:-" : "rgba:/out"];
        let output: Uint8Array;
        if (mode === "command") {
            const argumentValues = createCommandArguments(args);
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(result.exitCode).toBe(0);
            expect(stderr).toBe("");
            output = Buffer.concat(chunks);
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            output = mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        }
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
