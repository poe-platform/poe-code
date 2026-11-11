import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Captured with native ImageMagick: CMYK output alpha only receives CMYK sources.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        ["sRGB", "CMYK", "0.5,1 0.5,1", "ce677d20"],
        ["sRGB", "CMYK", "1,1 0,1", "cba35500"],
        ["sRGB", "CMYK", "0,1 1,1", "cc359a40"],
        ["CMYK", "sRGB", "0.5,1 0.5,1", "368e9440"],
        ["CMYK", "sRGB", "1,1 0,1", "345caa80"],
        ["CMYK", "sRGB", "0,1 1,1", "33ca6500"],
        ["sRGB", "sRGB", "0.5,1 0.5,1", "8049a260"],
        ["CMYK", "CMYK", "0.5,1 0.5,1", "7a4ba460"],
    ])(`${mode}: blends translucent %s/%s with %s`, async (first, second, terms, expected) => {
        for (const alphaOnly of [false, true]) {
            const fs = createMemoryFileSystem(), stdout: Uint8Array[] = [];
            let stderr = "";
            const args = ["(", "xc:#345caa80", "-colorspace", first, ")",
                "(", "xc:#cc359a40", "-colorspace", second, ")", "-poly", terms,
                ...(alphaOnly ? ["-channel", "A", "-separate", "-depth", "8", "gray:-"]
                    : ["-colorspace", "sRGB", "-depth", "8", "rgba:-"])];
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, new Map())
                : await runMagickCli(args, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = mode === "command" ? Buffer.concat(stdout)
                : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
            expect(Buffer.from(bytes).toString("hex")).toBe(alphaOnly ? expected.slice(-2) : expected);
        }
    });
}
