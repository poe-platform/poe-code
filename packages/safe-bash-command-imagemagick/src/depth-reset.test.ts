import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7 Q16-HDRI reference bytes, including nonopaque alpha samples.
const rgba8 = "d03090802070b0ff603020ff20a040ff1020c080603020ffd0309080a0101080";
const rgba16 = "d0d030309090808020207070b0b0ffff606030302020ffff2020a0a04040ffff10102020c0c08080606030302020ffffd0d0303090908080a0a0101010108080";

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const [options, depth, hex] of [
        [["-depth", "8", "+depth"], 16, rgba16],
        [["-depth", "8"], 8, rgba8],
        [["-depth", "16"], 16, rgba16],
        [["-depth", "8", "+depth", "-depth", "8"], 8, rgba8],
    ] as const) {
        it.each(["rgba", "info"])(`writes native depth for ${options.join(" ")} via ${mode} (%s)`, async coder => {
            const files = new Map([
                ["/in.raw", Buffer.from(rgba8, "hex")],
                ["/out", Buffer.from("KEEP")],
            ]);
            const argv = ["-size", "4x2", "-depth", "8", "rgba:/in.raw", "-colorspace", "sRGB", ...options,
                ...(coder === "info" ? ["-format", "%z;"] : []), `${coder}:/out`];
            let output: Uint8Array;
            if (mode === "command") {
                const fs = new MemoryFileSystem();
                for (const [path, bytes] of files) await fs.writeFile(path, bytes);
                const args = createCommandArguments(argv);
                let stdout = "", stderr = "";
                const result = await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                });
                expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
                output = await fs.readFile("/out");
            } else {
                const result = mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, files);
                expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
                output = files.get("/out")!;
            }
            expect(Buffer.from(output)).toEqual(coder === "info" ? Buffer.from(`${depth};`) : Buffer.from(hex, "hex"));
        });
    }
}
