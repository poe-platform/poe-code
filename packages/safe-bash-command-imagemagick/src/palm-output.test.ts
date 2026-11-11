import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, using the same PPM bytes and argv.
const input = new Uint8Array([...new TextEncoder().encode("P6\n12 8\n255\n"), ...Array.from({ length: 288 }, (_, i) => (i * 53 + i * i * 7) % 256)]);
const paletteArgs = ["in.ppm", "+dither", "-colors", "5", "-unique-colors"];
for (const mode of ["sync", "buffered", "retained", "command"]) {
    for (const [name, args, expected] of [
        ["red Palm bitmap", ["-size", "2x1", "xc:red", "palm:-"], "00020001000240000100000000ff00000000"],
        ["five-color Palm bitmap", [...paletteArgs, "PALM:-"], "00050001000440000401000000ff0000b30f7000"],
        ["RGB8 control", [...paletteArgs, "-depth", "8", "rgb:-"], "c2403b679079b6cb3f453abcbe3fcf"],
    ] as const) {
        it(`${mode} preserves ${name}`, async () => {
            const files = new Map([["in.ppm", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
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
            else if ("stdout" in result && (typeof result.stdout === "string" || result.stdout instanceof Uint8Array)) chunks.push(typeof result.stdout === "string" ? new TextEncoder().encode(result.stdout) : result.stdout);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const stdout = Buffer.concat(chunks);
            expect(stdout.toString("hex")).toBe(expected);
        });
    }
}

for (const destination of ["/output.palm", "PALM:/output.bin"]) {
    it(`writes Palm files and -write output through ${destination}`, async () => {
        const filesystem = new MemoryFileSystem();
        const result = await runConvertCli(["-size", "2x1", "xc:red", "-write", destination, "palm:-"], { filesystem, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        const output = await filesystem.readFile(destination.startsWith("PALM:") ? destination.slice(5) : destination);
        expect(Buffer.from(output).toString("hex")).toBe("00020001000240000100000000ff00000000");
        expect(result.stdoutBytes).toEqual(output);
    });
}
