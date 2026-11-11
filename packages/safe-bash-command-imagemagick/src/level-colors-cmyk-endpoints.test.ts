import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: endpoint inks are used directly, even on sRGB.
const cases = [
    { options: [], operator: "+level-colors", colors: "cmyk(0%,50%,100%,20%),white", expected: "34aeffff" },
    { options: [], operator: "-level-colors", colors: "cmyk(0%,50%,100%,20%),white", expected: "34000000" },
    { options: [], operator: "+level-colors", colors: "black,cmyk(0%,50%,100%,20%)", expected: "002eaaff" },
    { options: [], operator: "-level-colors", colors: "black,cmyk(0%,50%,100%,20%)", expected: "ffb8aa00" },
    { options: [], operator: "+level-colors", colors: "#0080ff,white", expected: "34aeffff" },
    { options: [], operator: "+level-colors", colors: "#cc6600,white", expected: "d69daaff" },
    { options: ["-colorspace", "CMYK"], operator: "+level-colors", colors: "cmyk(0%,50%,100%,20%),white", expected: "b1baff22ff" },
    { options: ["-colorspace", "CMYK"], operator: "+level-colors", colors: "cmyk(0%,50%,100%,0%),white", expected: "b1baff00ff" },
    { options: ["-colorspace", "CMYK"], operator: "-level-colors", colors: "cmyk(0%,50%,100%,20%),white", expected: "b100000000" },
    { options: ["-colorspace", "CMYK"], operator: "+level-colors", colors: "black,cmyk(0%,50%,100%,20%)", expected: "003b0011ff" },
    { options: ["-colorspace", "CMYK"], operator: "-level-colors", colors: "black,cmyk(0%,50%,100%,20%)", expected: "ffea00ff00" },
    { options: ["-colorspace", "CMYK", "-channel", "K"], operator: "+level-colors", colors: "cmyka(0%,50%,100%,20%,0.25),white", expected: "b175002280" },
    { options: ["-colorspace", "CMYK", "-channel", "A"], operator: "+level-colors", colors: "cmyka(0%,50%,100%,20%,0.25),white", expected: "b1750055a0" },
    { options: [], operator: "+level-colors", colors: "cmyka(0,127.5,255,51,0.25),white", expected: "34aeffa0" },
];

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each(cases)(`${mode}: $options $operator '$colors' matches native endpoint bytes`, async ({ options, operator, colors, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const command = mode === "magick" || mode === "convert";
        const output = options.includes("CMYK") ? "cmyka" : "rgba";
        const argv = ["xc:#345caa80", ...options, operator, colors, "-depth", "8", `${output}:${command ? "-" : "/out.raw"}`];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = command
            ? await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode, args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            })
            : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = command ? Buffer.concat(chunks)
            : mode === "retained" ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
