import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("ff0000ff00ff00800000ff40fdfbf9bf080808ff627f9113", "hex")
]);
// ImageMagick 7.1.2-35 Q16-HDRI, little-endian raw exports.
const fixtures = [
    { coder: "rgb", depth: 16, format: "floating-point", hex: "003c000000000000003c000000000000003cf03be03bd03b0428042804282636f8378d38" },
    { coder: "gray", depth: 16, format: "floating-point", hex: "ce32b9399f2ce23b0428aa37" },
    { coder: "rgb", depth: 32, format: "floating-point", hex: "0000803f0000000000000000000000000000803f0000000000000000000000000000803ffefd7d3ffcfb7b3ffaf9793f8180003d8180003d8180003dc5c4c43efffefe3e9291113f" },
    { coder: "rgb", depth: 64, format: "floating-point", hex: "000000000000f03f000000000000000000000000000000000000000000000000000000000000f03f000000000000000000000000000000000000000000000000000000000000f03fc0bfbfbfbfbfef3f7f7f7f7f7f7fef3f3f3f3f3f3f3fef3f101010101010a03f101010101010a03f101010101010a03f999898989898d83fe0dfdfdfdfdfdf3f323232323232e23f" },
    { coder: "rgb", depth: 16, format: "unsigned", hex: "ffff000000000000ffff000000000000fffffdfdfbfbf9f908080808080862627f7f9191" }
];
for (const mode of ["command", "buffered", "sync"] as const) {
    for (const endian of ["LSB", "MSB"]) {
        for (const destination of ["file", "stdout", "-write", "split", "partition"] as const) {
            it.each(fixtures.filter(fixture => destination !== "partition" || fixture.coder === "rgb"))(`${mode} ${endian} ${destination}: $format $depth $coder`, async ({ coder, depth, format, hex }) => {
                const files = new Map<string, Uint8Array>([["/in.pam", input], ["/out", Buffer.from("KEEP")]]);
                const fs = new MemoryFileSystem();
                for (const [path, bytes] of files) await fs.writeFile(path, bytes);
                const target = `${coder}:${destination === "stdout" ? "-" : "/out"}`;
                const args = ["/in.pam", "(", "/in.pam", "-flip", ")", "-define", `quantum:format=${format}`, "-depth", String(depth), "-endian", endian,
                    ...(destination === "split" ? ["+adjoin"] : destination === "partition" ? ["-interlace", "partition"] : []),
                    ...(destination === "-write" ? ["-write", target, "null:"] : [target])];
                const stdout: Uint8Array[] = [];
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const first = Buffer.from(hex, "hex");
                if (endian === "MSB") {
                    if (depth === 16) first.swap16();
                    else if (depth === 32) first.swap32();
                    else first.swap64();
                }
                const second = Buffer.concat([first.subarray(first.length / 2), first.subarray(0, first.length / 2)]);
                const read = async (path: string) => Buffer.from(mode === "command" ? await fs.readFile(path) : files.get(path)!);
                if (destination === "split") {
                    expect(await read("/out")).toEqual(Buffer.from("KEEP"));
                    expect(await read("/out-0")).toEqual(first);
                    expect(await read("/out-1")).toEqual(second);
                } else if (destination === "partition" && coder === "rgb") {
                    const joined = Buffer.concat([first, second]);
                    for (const [channel, suffix] of ["R", "G", "B"].entries()) {
                        const samples: Uint8Array[] = [];
                        for (let pixel = 0; pixel < 12; pixel++) samples.push(joined.subarray((pixel * 3 + channel) * depth / 8, (pixel * 3 + channel + 1) * depth / 8));
                        expect(await read(`/out.${suffix}`)).toEqual(Buffer.concat(samples));
                    }
                } else if (destination === "stdout") {
                    expect(Buffer.from(mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array())).toEqual(Buffer.concat([first, second]));
                } else expect(await read("/out")).toEqual(Buffer.concat([first, second]));
            });
        }
    }
}

it.each([false, true])("preserves 16-bit source precision and resets floating-point output, retained=%s", async retained => {
    const high = Buffer.concat([Buffer.from("P7\nWIDTH 2\nHEIGHT 1\nDEPTH 3\nMAXVAL 65535\nTUPLTYPE RGB\nENDHDR\n"), Buffer.from("00000001000200037fffffff", "hex")]);
    const files = new Map<string, Uint8Array>([["/in.pam", high]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.pam", high);
    const result = await runMagickCli(["/in.pam", "-define", "quantum:format=floating-point", "-depth", "16", "-endian", "LSB", "-write", "rgb:/float", "+define", "quantum:format", "rgb:/unsigned"], retained ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const read = async (path: string) => Buffer.from(retained ? await filesystem.readFile(path) : files.get(path)!).toString("hex");
    // Native Q16-HDRI output includes binary16 subnormal samples.
    expect(await read("/float")).toBe("00000001000200030038003c");
    expect(await read("/unsigned")).toBe("0000010002000300ff7fffff");
});
