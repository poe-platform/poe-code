import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI: reset quantum:format after input to isolate decoding.
const samples = [
    { depth: 16, hex: "000000340038003c", gray: "000000ff404040ff808080ffffffffff", rgb: "004080ffff0040ff80ff00ff4080ffff" },
    { depth: 32, hex: "000000000000803e0000003f0000403f", gray: "000000ff404040ff808080ffbfbfbfff", rgb: "004080ffbf0040ff80bf00ff4080bfff" },
    { depth: 64, hex: "0000000000000000000000000000d03f000000000000e03f000000000000e83f", gray: "000000ff404040ff808080ffbfbfbfff", rgb: "004080ffbf0040ff80bf00ff4080bfff" }
];

for (const mode of ["file", "stream", "sync"] as const) {
    for (const coder of ["gray", "rgb"] as const) {
        for (const endian of [undefined, "LSB", "MSB"] as const) {
            it.each(samples)(`reads $depth-bit floating-point ${coder} via ${mode}, ${endian ?? "default endian"}`, async ({ depth, hex, ...expected }) => {
                const input = Buffer.from(hex.repeat(coder === "rgb" ? 3 : 1), "hex");
                if (endian === "MSB") for (let offset = 0; offset < input.length; offset += depth / 8) input.subarray(offset, offset + depth / 8).reverse();
                const argv = ["-size", "2x2", "-depth", String(depth), ...(endian ? ["-endian", endian] : []), "-define", "quantum:format=floating-point", `${coder}:${mode === "stream" ? "-" : "in.bin"}`, "-append", "-define", "quantum:format=unsigned", "-depth", "8", "rgba:out"];
                const files = new Map<string, Uint8Array>([["in.bin", input], ["out", Buffer.from("KEEP")]]);
                if (mode === "sync") {
                    const result = runMagickCliSync(argv, files);
                    expect(result.stderr).toBe("");
                    expect(result.exitCode).toBe(0);
                    expect(Buffer.from(files.get("out")!).toString("hex")).toBe(expected[coder]);
                    return;
                }
                const fs = new MemoryFileSystem();
                for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
                const args = createCommandArguments(argv);
                let stderr = "";
                const result = await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal,
                    stdin: (async function* () { for (const byte of input) yield Uint8Array.of(byte); })(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
                expect(stderr).toBe("");
                expect(result.exitCode).toBe(0);
                expect(Buffer.from(await fs.readFile("/out")).toString("hex")).toBe(expected[coder]);
            });
        }
    }
}

it.each(["unsigned", "reset"])("retains integer GRAY decoding with quantum format %s", format => {
    const files = new Map<string, Uint8Array>([["in.bin", Buffer.from(samples[0]!.hex, "hex")]]);
    const options = format === "reset" ? ["-define", "quantum:format=floating-point", "+define", "quantum:format"] : ["-define", "quantum:format=unsigned"];
    const result = runMagickCliSync(["-size", "2x2", "-depth", "16", ...options, "gray:in.bin", "-append", "-define", "quantum:format=unsigned", "-depth", "8", "rgba:out"], files);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(files.get("out")!).toString("hex")).toBe("000000ff343434ff383838ff3c3c3cff");
});

for (const coder of ["gray", "rgb"]) it.each(samples)(`rejects truncated $depth-bit floating-point ${coder} without overwriting output`, ({ depth, hex }) => {
    const original = Buffer.from("KEEP"), input = Buffer.from(hex.repeat(coder === "rgb" ? 3 : 1), "hex");
    const files = new Map<string, Uint8Array>([["in.bin", input.subarray(0, input.length - 1)], ["out", original]]);
    const result = runMagickCliSync(["-size", "2x2", "-depth", String(depth), "-define", "quantum:format=floating-point", `${coder}:in.bin`, "-depth", "8", "rgba:out"], files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unexpected end-of-file");
    expect(files.get("out")).toBe(original);
});
