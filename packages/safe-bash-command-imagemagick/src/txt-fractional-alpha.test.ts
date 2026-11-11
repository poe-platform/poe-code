import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import { srgbDepthEnumerationLine } from "./text-output.js";

// ImageMagick 7.1.2-35 Q16-HDRI: xc:rgba(32,64,128,ALPHA) -depth 16 txt:-.
const cases = [
    ["0.5", "32768", "8000"],
    ["0.25", "16384", "4000"],
    ["0", "0", "0000"],
    ["1", "65535", "FFFF"],
];

for (const mode of ["sync", "buffered", "retained", "command"]) {
    it.each(cases)(`${mode} TXT preserves fractional alpha %s in its color annotation`, async (alpha, sample, hex) => {
        const args = [`xc:rgba(32,64,128,${alpha})`, "-depth", "16", "txt:-"];
        const fs = new MemoryFileSystem();
        let stdout = "", stderr = "";
        const result = mode === "sync" ? runConvertCliSync(args, new Map())
            : mode === "buffered" ? await runConvertCli(args, new Map())
            : mode === "retained" ? await runConvertCli(args, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async chunk => { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            });
        if ("stdout" in result && typeof result.stdout === "string") stdout = result.stdout;
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(stdout).toBe(`# ImageMagick pixel enumeration: 1,1,0,65535,srgba\n0,0: (8224,16448,32896,${sample})  #202040408080${hex}  srgba(32,64,128,${alpha})\n`);
    });
}

it("keeps encoded 16-bit alpha when no floating samples are available", () => {
    expect(srgbDepthEnumerationLine(0, 0, new Uint16Array([8224, 16448, 32896, 32768]), true, 16)).toBe(
        "0,0: (8224,16448,32896,32768)  #2020404080808000  srgba(32,64,128,0.500008)"
    );
});

it("quantizes alpha when explicitly reducing the output depth", () => {
    expect(srgbDepthEnumerationLine(0, 0, new Uint16Array([8224, 16448, 32896, 32768]), true, 8, new Float64Array([32, 64, 128, 127.5]))).toBe(
        "0,0: (32,64,128,128)  #20408080  srgba(32,64,128,0.501961)"
    );
});
