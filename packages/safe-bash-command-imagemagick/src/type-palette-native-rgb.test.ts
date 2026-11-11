import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI retains the working RGB colorspace after -type.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const type of ["Palette", "PaletteAlpha"]) {
        for (const space of ["DisplayP3", "Adobe98", "ProPhoto", "sRGB"]) {
            it.each(["info", "rgba"])(`${mode}: ${type} retains ${space} for %s output`, async output => {
                const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
                const argv = ["xc:#b0305070", "-colorspace", space, "-type", type,
                    ...(output === "info" ? ["-format", "%[colorspace]"] : ["-colorspace", "sRGB", "-depth", "8"]), `${output}:/out`];
                const argumentValues = createCommandArguments(argv);
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                expect(result.exitCode).toBe(0);
                const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
                expect(Buffer.from(bytes).toString(output === "info" ? "utf8" : "hex")).toBe(
                    output === "info" ? space : type === "PaletteAlpha" ? "b0305070" : "b03050ff");
            });
        }
    }
    it.each([
        { space: "DisplayP3", type: true, expected: "b03050708a3ba580" },
        { space: "DisplayP3", type: false, expected: "b03050708a3ba580" },
        { space: "sRGB", type: true, expected: "b03050708040a080" },
    ])(`${mode}: splice uses $space after palette conversion=$type`, async ({ space, type, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["xc:#b0305070", "-colorspace", space, ...(type ? ["-type", "PaletteAlpha"] : []),
            "-background", "#8040a080", "-splice", "1x0+1+0", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
