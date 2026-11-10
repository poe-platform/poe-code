import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { createMagickCommand, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 4\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE CMYK\nENDHDR\n"),
    Buffer.from([25, 25, 25, 10, 200, 31, 0, 150, 60, 128, 220, 201, 20, 80, 10, 255])
]);
// ImageMagick 7.1.2-35 Q16-HDRI decoded RGBA16 samples.
const expected = "ddd8ddd8ddd8ffff16bc5c986969ffff29751b000771ffff000000000000ffff";
for (const mode of ["public", "sync"] as const) {
    for (const [args, output] of [
        [["ink.pam", "-colorspace", "sRGB", "PNG64:out"], expected],
        [["ink.pam", "PNG64:out"], expected],
        [["ink.pam", "-colorspace", "sRGB", "-format", "%[colorspace] %[fx:u.r] %[fx:u.k]", "info:out"], "sRGB 0.86659 0.86659"],
        [["ink.pam", "-format", "%[colorspace] %[fx:u.r] %[fx:u.k]", "info:out"], "CMYK 0.0980392 0.0392157"],
        [["xc:#4080c0", "PNG64:out"], "40408080c0c0ffff"]
    ] as const) it(`retains CMYK conversion precision, ${mode}: ${args.join(" ")}`, async () => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>([["ink.pam", input], ["out", Buffer.from("KEEP")]]);
        for (const [path, bytes] of files) await fs.writeFile("/" + path, bytes);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync([...args], files) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments([...args]).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} },
            stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, stderr).toBe(0);
        const bytes = mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        if (args.at(-1) === "info:out") expect(Buffer.from(bytes).toString()).toBe(output);
        else expect(Array.from(decodeImage(bytes).data16 ?? []).map(value => value.toString(16).padStart(4, "0")).join("")).toBe(output);
    });
}
