import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw big-endian RGBA samples.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { colorspace: "Lab", interpolation: "bilinear", hex: "7d0271d1841e77fc97b363e2722cb254" },
        { colorspace: "Lab", interpolation: "mesh", hex: "7d0271d1841e77fc97b363e2722cb254" },
        { colorspace: "Lab", interpolation: "average", hex: "8628773576b481818628773576b48181" },
        { colorspace: "Lab", interpolation: "integer", hex: "70b0a00e527933339ba1a00e5279cfcf" },
        { colorspace: "sRGB", interpolation: "bilinear", hex: "5dfe853a7b9d77fc31b192c29041b254" },
    ])(`${mode}: $interpolation CLUT with a $colorspace lookup retains Q16 precision`, async ({ colorspace, interpolation, hex }) => {
        const argv = ["(", "xc:#173e5970", "xc:#b56829cf", "+append", "-colorspace", "sRGB", ")",
            "(", "(", "xc:#7258b433", "xc:#2ba761cf", "+append", ")", "-colorspace", colorspace, ")",
            "-interpolate", interpolation, "-clut", "+channel", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB",
            `rgba:${mode === "command" ? "-" : "/out"}`];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(mode === "command" ? stdout : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex")).toBe(hex);
    });
}
