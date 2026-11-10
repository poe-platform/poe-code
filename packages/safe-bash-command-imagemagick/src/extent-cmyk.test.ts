import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw CMYKA8 samples.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["#297d38", "2x1", "00c95d4affe300cecbff"],
        ["#297d38", "2x1+2+0", "e300cecbffe300cecbff"],
        ["white", "2x1", "00c95d4aff00000000ff"],
    ])(`${mode}: extent preserves CMYK padding for %s at %s`, async (background, geometry, expected) => {
        const argv = ["xc:#b52673", "-colorspace", "CMYK", "-background", background!,
            "-compose", "Src", "-extent", geometry!, "-depth", "8", "cmyka:/out"];
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
