import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const ppm = new Uint8Array([...new TextEncoder().encode("P6\n12 8\n255\n"), ...Array.from({ length: 288 }, (_, i) => (i * 53 + i * i * 7) % 256)]);
const uyvyInput = Buffer.from("50360a3420320a3235350aff000000ff000000ffffffff000000ff8000fe0180804080", "hex");
const palette = ["in.ppm", "+dither", "-colors", "5", "-unique-colors"];

// Native ImageMagick 7.1.2-35 Q16-HDRI stdout for identical inputs and arguments.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const [name, args, hex] of [
        ["UYVY stdout", ["uyvy.ppm", "-depth", "8", "uyvy:-"], "404c8a96bf1d75ff5500a497955bc75a"],
        ["PAL fixture control", ["uyvy.ppm", "-depth", "8", "pal:-"], "404c8a96bf1d75ff5500a497955bc75a"],
        ["UYVY files and intermediate writes", ["uyvy.ppm", "-depth", "8", "-write", "out.uyvy", "-write", "UYVY:out.bin", "UYVY:-"], "404c8a96bf1d75ff5500a497955bc75a"],
        ["red PAL", ["-size", "2x1", "xc:red", "pal:-"], "544cff4c"],
        ["odd-width palette PAL", [...palette, "pal:-"], "716797817eb57d4c99759900"],
        ["chunked PAL", ["-size", "2050x1", "xc:red", "pal:-"], "544cff4c".repeat(1025)],
        ["PAL files and intermediate writes", ["-size", "2x1", "xc:red", "-write", "out.pal", "-write", "PAL:out.bin", "pal:-"], "544cff4c"],
        ["RGB control", [...palette, "-depth", "8", "rgb:-"], "c2403b679079b6cb3f453abcbe3fcf"],
    ] as const) {
        it(`${mode} writes ${name} bytes`, async () => {
            const fs = new MemoryFileSystem(), files = new Map([["in.ppm", ppm], ["uyvy.ppm", uyvyInput]]);
            await fs.writeFile("/in.ppm", ppm);
            await fs.writeFile("/uyvy.ppm", uyvyInput);
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : mode === "buffered" ? await runConvertCli(args, files)
                : mode === "retained" ? await runConvertCli(args, { filesystem: fs, cwd: "/" })
                : await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { write: async chunk => { chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk.slice()); } },
                    stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                });
            if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) chunks.push(result.stdoutBytes);
            else if ("stdout" in result && typeof result.stdout === "string") chunks.push(new TextEncoder().encode(result.stdout));
            else if ("stdout" in result && result.stdout instanceof Uint8Array) chunks.push(result.stdout);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            expect(files.has("uyvy:-")).toBe(false);
            expect((await fs.readdir("/")).map(entry => entry.name)).not.toContain("uyvy:-");
            expect(Buffer.concat(chunks).toString("hex")).toBe(hex);
            if (args.some(arg => arg === "-write")) for (const path of [args.some(arg => arg === "out.uyvy") ? "out.uyvy" : "out.pal", "out.bin"]) {
                const data = mode === "sync" || mode === "buffered" ? files.get(path)! : await fs.readFile(`/${path}`);
                expect(Buffer.from(data).toString("hex")).toBe(hex);
            }
        });
    }
}
