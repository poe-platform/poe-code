import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, using the same PPM bytes and argv.
const input = new Uint8Array([...new TextEncoder().encode("P6\n12 8\n255\n"), ...Array.from({ length: 288 }, (_, i) => (i * 53 + i * i * 7) % 256)]);
const paletteArgs = ["in.ppm", "+dither", "-colors", "5", "-unique-colors"];
const paletteText = "# ImageMagick pixel enumeration: 5,1,0,255,srgb\n"
    + "0,0: (194,64,59)  #C2403B  srgb(76.1158%,25.2848%,22.9692%)\n"
    + "1,0: (103,144,121)  #679079  srgb(40.4793%,56.6013%,47.5381%)\n"
    + "2,0: (182,203,63)  #B6CB3F  srgb(71.3235%,79.7059%,24.5588%)\n"
    + "3,0: (69,58,188)  #453ABC  srgb(27.0588%,22.5882%,73.8039%)\n"
    + "4,0: (190,63,207)  #BE3FCF  srgb(74.3288%,24.7964%,81.1463%)\n";

for (const mode of ["sync", "buffered", "retained", "command"]) {
    for (const [name, args, expected] of [
        ["fractional palette annotations", [...paletteArgs, "txt:-"], new TextEncoder().encode(paletteText)],
        ["RGB8 palette bytes", [...paletteArgs, "-depth", "8", "rgb:-"], Uint8Array.from(Buffer.from("c2403b679079b6cb3f453abcbe3fcf", "hex"))],
        ["named colors", ["-size", "2x1", "xc:red", "txt:-"], new TextEncoder().encode("# ImageMagick pixel enumeration: 2,1,0,65535,srgb\n0,0: (65535,0,0)  #FFFF00000000  red\n1,0: (65535,0,0)  #FFFF00000000  red\n")],
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
            else if ("stdout" in result && typeof result.stdout === "string") chunks.push(new TextEncoder().encode(result.stdout));
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const stdout = Buffer.concat(chunks);
            if (args.at(-1) === "txt:-") expect(stdout.toString()).toBe(new TextDecoder().decode(expected));
            else expect(stdout.toString("hex")).toBe(Buffer.from(expected).toString("hex"));
        });
    }
}
