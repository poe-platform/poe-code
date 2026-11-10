import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI retains the middle level at 32767.5.
for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        [[], "0.5/0.5/0"],
        [["-channel", "R", "-threshold", "32767.75", "-separate", "+channel"], "0/0/0"],
        [["-channel", "R", "-threshold", "32767", "-separate", "+channel"], "1/1/1"],
        [["-channel", "R", "-threshold", "32768", "-separate", "+channel"], "0/0/0"]
    ] as const)(`${mode}: retains fractional posterization before %j`, async (operations, expected) => {
        const args = ["xc:#804020", "-colorspace", "sRGB", "+dither", "-posterize", "3", ...operations,
            ...(operations.length ? ["-depth", "8", "-write", "gray:/out.gray"] : []),
            "-format", "%[fx:r]/%[fx:g]/%[fx:b]", "info:-"];
        let stdout = "";
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
        expect(result.exitCode).toBe(0);
        if (operations.length) {
            const output = mode === "command" ? await fs.readFile("/out.gray") : files.get("/out.gray")!;
            expect([...output]).toEqual([expected === "1/1/1" ? 255 : 0]);
        }
        expect(mode === "command" ? stdout : ("stdout" in result ? result.stdout : "")).toBe(expected);
    });
}
