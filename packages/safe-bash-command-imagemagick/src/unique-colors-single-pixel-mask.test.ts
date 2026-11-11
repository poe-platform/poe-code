import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native 7.1.2-35 Q16-HDRI reads uninitialized palette mask/alpha samples.
// With GLIBC_TUNABLES=glibc.malloc.tcache_count=0, MALLOC_PERTURB_=1/85/170
// makes the white-mask red case output 00000000/ff000080/ffffffff.
// Preserve the source RGBA instead of reproducing allocator-dependent pixels.
const cases = [
    { name: "red with white mask", color: "ff000080", operations: ["-write-mask", "xc:white", "-unique-colors", "+write-mask"], hex: "ff000080" },
    { name: "green with white mask", color: "00ff0040", operations: ["-write-mask", "xc:white", "-unique-colors", "+write-mask"], hex: "00ff0040" },
    { name: "white mask alpha lookup", color: "ff000080", operations: ["-write-mask", "xc:white", "-unique-colors", "+write-mask"], text: "1x1:0.501961" },
    { name: "mask removed before extraction", color: "ff000080", operations: ["-write-mask", "xc:white", "+write-mask", "-unique-colors"], hex: "ff000080" },
    { name: "black mask", color: "ff000080", operations: ["-write-mask", "xc:black", "-unique-colors", "+write-mask"], hex: "ff000080" },
    { name: "sort pixels control", color: "ff000080", operations: ["-write-mask", "xc:white", "-sort-pixels", "+write-mask"], hex: "c0000080" }
];

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each(cases)(`${mode}: $name`, async ({ color, operations, hex, text }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = [`xc:#${color}`, ...operations, ...(text
            ? ["-format", "%wx%h:%[fx:a]", "info:out"] : ["-depth", "8", "rgba:out"])];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        expect(Buffer.from(output).toString(text ? "utf8" : "hex")).toBe(text ?? hex);
    });
}
