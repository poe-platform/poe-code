import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference pixels, RGBA16 big-endian.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        { terms: "1,1,0,1", expected: "17193e3e59587070" },
        { terms: "0,1,1,1", expected: "b5b768642925cfcf" },
        { terms: "0.25,1,0.75,1", expected: "94ca5ddc3900b7f7" },
        { source: "xc:#173e5970", expected: "17193e3e59587070" },
        { source: "xc:#b56829cf", expected: "b5b768642925cfcf" },
    ])(`${mode}: preserves Lab precision for $terms $source`, async ({ terms, source, expected }) => {
        const argv = source ? [source, "-colorspace", "Lab"] : [
            "(", "xc:#173e5970", "-colorspace", "Lab", ")",
            "(", "xc:#b56829cf", "-colorspace", "Lab", ")", "-poly", terms!,
        ];
        argv.push("-colorspace", "sRGB", "-depth", "16", "-endian", "MSB", "rgba:-");
        const fs = new MemoryFileSystem(), stdout: Uint8Array[] = [];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
