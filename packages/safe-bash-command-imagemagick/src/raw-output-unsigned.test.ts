import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("ff0000ff00ff00800000ff40fdfbf9bf080808ff627f9113", "hex")
]);
// ImageMagick 7.1.2-35 Q16-HDRI, quantum:format=unsigned, default endian.
const cases = [
    { coder: "rgb", depth: 16, hex: "ffff000000000000ffff000000000000fffffdfdfbfbf9f908080808080862627f7f9191" },
    { coder: "rgb", depth: 32, hex: "ffffffff000000000000000000000000ffffffff000000000000000000000000fffffffffdfdfdfdfbfbfbfbf9f9f9f9080808080808080808080808626262627f7f7f7f91919191" },
    { coder: "rgb", depth: 64, hex: "ffffffffffffffff000000000000000000000000000000000000000000000000ffffffffffffffff000000000000000000000000000000000000000000000000fffffffffffffffffdfdfdfdfdfe0000fbfbfbfbfbfbf800f9f9f9f9f9f9f80008080808080808000808080808080800080808080808080062626262626264007f7f7f7f7f7f80009191919191919000" },
    { coder: "gray", depth: 16, hex: "703614b77b1243fc08089c7a" },
    { coder: "gray", depth: 32, hex: "b09f7036149814b71bc87a12433044fc080808089c7c9c7a" },
    { coder: "gray", depth: 64, hex: "36709fb09fb0a000b714981498149800127ac81ac81ac800fc4430443044300008080808080808007a9c7c9c7c9c7c00" }
];

for (const mode of ["sync", "buffered", "command"] as const) {
    for (const frames of [1, 2]) {
        for (const endian of ["default", "LSB", "MSB"]) {
            it.each(cases)(`writes full-width unsigned $depth-bit $coder samples (${mode}, ${frames} frames, ${endian})`, async ({ coder, depth, hex }) => {
                const expected = Buffer.from(hex, "hex");
                // Native unsigned 64-bit output uses MSB-first packing regardless of -endian.
                if (endian === "MSB" && depth === 16) expected.swap16();
                if (endian === "MSB" && depth === 32) expected.swap32();
                const keep = new TextEncoder().encode("KEEP");
                const files = new Map<string, Uint8Array>([["/in.pam", input]]);
                const outputs = frames === 1 ? ["/out", "/copy"] : ["/out-0", "/copy-0", "/out-1", "/copy-1"];
                for (const path of outputs) files.set(path, keep);
                if (frames === 2) files.set("/next.pam", Buffer.concat([Buffer.from("P7\nWIDTH 1\nHEIGHT 1\nDEPTH 3\nMAXVAL 255\nTUPLTYPE RGB\nENDHDR\n"), Buffer.from([255, 255, 255])]));
                const fs = new MemoryFileSystem();
                for (const [path, bytes] of files) await fs.writeFile(path, bytes);
                const suffix = frames === 1 ? "" : "-%d";
                const args = ["/in.pam", ...(frames === 2 ? ["/next.pam"] : []), "-define", "quantum:format=unsigned", "-depth", String(depth), ...(endian === "default" ? [] : ["-endian", endian]), "-write", `${coder}:/copy${suffix}`, `${coder}:/out${suffix}`];
                let stderr = "";
                const result = mode === "sync" ? runConvertCliSync(args, files) : mode === "buffered" ? await runConvertCli(args, files) : await createMagickCommand().execute({
                    command: "magick", args, fs, cwd: "/", env: {},
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
                expect(result.exitCode, stderr).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                expect((mode === "command" ? (await fs.readdir("/")).map(entry => entry.name) : [...files.keys()].map(path => path.slice(1))).sort()).toEqual(["in.pam", ...(frames === 2 ? ["next.pam"] : []), ...outputs.map(path => path.slice(1))].sort());
                for (const path of outputs) {
                    const bytes = mode === "command" ? await fs.readFile(path) : files.get(path)!;
                    const frame = path.endsWith("-1") ? Buffer.alloc(depth / 8 * (coder === "rgb" ? 3 : 1), 255) : expected;
                    expect(Buffer.from(bytes)).toEqual(frame);
                }
            });
        }
    }
}

for (const mode of ["sync", "command"] as const) {
    for (const interlace of ["None", "Line", "Plane", "Partition"]) {
        it.each(cases.filter(({ coder, depth }) => coder === "rgb" && depth > 16))(`preserves wide samples across storage chunks (${mode}, ${interlace}, $depth bits)`, async ({ depth, hex }) => {
            const width = 3000, height = 2, sampleBytes = depth / 8;
            const pixels = Buffer.concat(Array.from({ length: 1000 }, () => input.subarray(input.length - 24)));
            const pam = Buffer.concat([Buffer.from(`P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`), pixels]);
            const native = Buffer.from(hex, "hex"), expected = Buffer.concat(Array.from({ length: 1000 }, () => native));
            const files = new Map<string, Uint8Array>([["/in.pam", pam]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.pam", pam);
            const args = ["/in.pam", "-define", "quantum:format=unsigned", "-depth", String(depth), "-interlace", interlace, "rgb:/out"];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, { filesystem: fs, cwd: "/" });
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            const runs: Uint8Array[] = [];
            if (interlace === "None") runs.push(expected);
            else {
                const rows = interlace === "Line" ? height : 1, rowPixels = width * height / rows;
                for (let row = 0; row < rows; row++) for (let channel = 0; channel < 3; channel++) {
                    const samples: Uint8Array[] = [];
                    for (let pixel = row * rowPixels; pixel < (row + 1) * rowPixels; pixel++) samples.push(expected.subarray((pixel * 3 + channel) * sampleBytes, (pixel * 3 + channel + 1) * sampleBytes));
                    runs.push(Buffer.concat(samples));
                }
            }
            const paths = interlace === "Partition" ? ["/out.R", "/out.G", "/out.B"] : ["/out"];
            for (const [index, path] of paths.entries()) {
                const bytes = mode === "sync" ? files.get(path)! : await fs.readFile(path);
                expect(Buffer.from(bytes)).toEqual(interlace === "Partition" ? runs[index] : Buffer.concat(runs));
            }
        });
    }
}
