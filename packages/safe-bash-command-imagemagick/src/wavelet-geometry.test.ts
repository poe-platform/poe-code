import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["magick", "convert", "retained", "buffered", "sync"] as const)
it.each([
    "16383.75x0.5", "16383.75,0.5", "16383.75/0.5", "(16383.75x0.5)", "16383.75x0.5+0+0",
    "1.638375e+4x5e-1+0+0", "bogus", "x0.5"
])(`${mode}: matches native wavelet geometry %s`, async geometry => {
    const input = Buffer.concat([
        Buffer.from("P6\n7 5\n255\n"),
        Buffer.from(Array.from({ length: 105 }, (_, i) => (i * 41 + 51) % 256))
    ]);
    const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.ppm", input);
    const args = ["/in.ppm", "-wavelet-denoise", geometry, "-depth", "8", "rgb:-"];
    const stdout: number[] = [];
    let stderr = "";
    const result = (mode === "magick" || mode === "convert") ? await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
        command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(...bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Uint8Array.from(stdout);
    if (geometry === "bogus" || geometry === "x0.5") {
        expect(result.exitCode).toBe(1);
        expect(stderr).toContain("Invalid wavelet denoise geometry");
        expect(output).toHaveLength(0);
    } else {
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        // ImageMagick 7.1.2-35 Q16-HDRI, raw row-major RGB bytes.
        expect(createHash("sha256").update(output).digest("hex")).toBe("80da667ea2dd672fcd22d6043f2bfcb0ddddcad9634f9dc0cf33b665a92d42c6");
    }
});
