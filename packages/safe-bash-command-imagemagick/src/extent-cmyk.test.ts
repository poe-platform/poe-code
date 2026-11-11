import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw CMYKA8 samples.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["#297d38", "2x1", "00c95d4affe300cecbff", "Src", "#b52673"],
        ["#297d38", "2x1+2+0", "e300cecbffe300cecbff", "Src", "#b52673"],
        ["white", "2x1", "00c95d4aff00000000ff", "Src", "#b52673"],
        ...["Copy", "Dst", "Clear", "Src", "Over"].map(compose => [
            "#30805080", "2x1", {
                Copy: "00b3665f70dc00a0c880", Dst: "dc00a0c880dc00a0c880",
                Clear: "0000000000dc00a0c880", Src: "00b3665f70dc00a0c880", Over: "566d7d88b8dc00a0c880",
            }[compose], compose, "#a0306070",
        ]),
        ...["Copy", "Dst", "Clear"].map(compose => ["#30805080", "2x1+2+0", "dc00a0c880dc00a0c880", compose, "#a0306070"]),
        ["#30805080", "2x1+1+0", "004e2d2a70dc00a0c880", "Copy", "#a0306070", "2x1"],
        ["white", "1x1", "00000000ff", "Dst", "#a0306070"],
    ])(`${mode}: extent preserves CMYK padding for %s at %s: %s (%s)`, async (background, geometry, expected, compose, source, size = "1x1") => {
        const argv = ["-size", size, `xc:${source}`, "-colorspace", "CMYK", "-background", background!,
            "-compose", compose!, "-extent", geometry!, "-depth", "8", "cmyka:/out"];
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
