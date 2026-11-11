import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI imports floating BGR in RGB order.
// Samples are .25, .5, .75, .125; BGRO treats the last sample as opacity.
const samples = [
    { depth: 16, hex: "340038003a003000" },
    { depth: 32, hex: "3e8000003f0000003f4000003e000000" },
    { depth: 64, hex: "3fd00000000000003fe00000000000003fe80000000000003fc0000000000000" }
];
const coders = [
    { coder: "bgr", output: "4080bfff" },
    { coder: "bgra", output: "4080bf20" },
    { coder: "bgro", output: "4080bfdf" }
];

for (const mode of ["file", "stream", "sync"] as const) {
    for (const { coder, output } of coders) {
        for (const endian of [undefined, "LSB", "MSB"] as const) {
            it.each(samples)(`${mode}: reads $depth-bit floating ${coder}, ${endian ?? "default endian"}`, async ({ depth, hex }) => {
                const input = Buffer.from(hex.slice(0, coder.length * depth / 4), "hex");
                if (endian !== "MSB") for (let i = 0; i < input.length; i += depth / 8) input.subarray(i, i + depth / 8).reverse();
                const args = ["-size", "1x1", "-depth", String(depth), ...(endian ? ["-endian", endian] : []), "-define", "quantum:format=floating-point", `${coder}:${mode === "stream" ? "-" : "/in"}`, "+define", "quantum:format", "-depth", "8", "rgba:-"];
                if (mode === "sync") {
                    const result = runMagickCliSync(args, new Map([["/in", input]]));
                    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
                    expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(output);
                    return;
                }
                const fs = new MemoryFileSystem();
                await fs.writeFile("/in", input);
                const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
                const result = await createMagickCommand().execute({
                    command: "magick", args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal,
                    stdin: (async function* () { for (const byte of input) yield Uint8Array.of(byte); })(),
                    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderr.push(bytes.slice()); } }
                });
                expect(Buffer.concat(stderr).toString()).toBe("");
                expect(result.exitCode).toBe(0);
                expect(Buffer.concat(stdout).toString("hex")).toBe(output);
            });
        }
    }
}

for (const mode of ["file", "sync"] as const) {
    for (const { coder } of coders) {
        it.each(samples)(`${mode}: rejects truncated $depth-bit floating ${coder} without replacing output`, async ({ depth, hex }) => {
            const keep = new TextEncoder().encode("KEEP"), input = Buffer.from(hex.slice(0, coder.length * depth / 4 - 2), "hex");
            const files = new Map<string, Uint8Array>([["/in", input], ["/out", keep]]), fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const args = ["-size", "1x1", "-depth", String(depth), "-endian", "MSB", "-define", "quantum:format=floating-point", `${coder}:/in`, "+define", "quantum:format", "-depth", "8", "rgba:/out"];
            const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain("unexpected end-of-file");
            expect(mode === "sync" ? files.get("/out") : await fs.readFile("/out")).toEqual(keep);
        });
        it.each(["unsigned", "reset"])(`${mode}: keeps integer ${coder} channel order with %s quantum format`, async format => {
            const input = Buffer.from(samples[0]!.hex.slice(0, coder.length * 4), "hex");
            const files = new Map([["/in", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in", input);
            const options = format === "reset" ? ["-define", "quantum:format=floating-point", "+define", "quantum:format"] : ["-define", "quantum:format=unsigned"];
            const args = ["-size", "1x1", "-depth", "16", "-endian", "MSB", ...options, `${coder}:/in`, "-depth", "8", "rgba:/out"];
            const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            const output = mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
            expect(Buffer.from(output).toString("hex")).toBe(`3a3834${coder === "bgr" ? "ff" : coder === "bgra" ? "30" : "cf"}`);
        });
    }
}
