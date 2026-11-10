import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI resets gamma only when converting to sRGB.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const space of ["HSL", "CMYK", "Lab", "sRGB"]) {
        for (const convert of [false, true]) {
            it.each([
                { options: ["-set", "gamma", "0.8"], gamma: "0.8" },
                { options: ["-gamma", "2"], gamma: "0.909091" },
            ])(`${mode}: ${space}, convert=${convert}, $options gamma metadata`, async ({ options, gamma }) => {
                const args = ["xc:#4080c080", "-colorspace", space, ...options,
                    ...(convert ? ["-colorspace", "sRGB"] : []), "-format", "%[gamma]", "info:/out"];
                const fs = new MemoryFileSystem();
                const files = new Map<string, Uint8Array>();
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
                expect(new TextDecoder().decode(output)).toBe(convert && space !== "sRGB" ? "0.454545" : gamma);
            });
        }
    }
}
