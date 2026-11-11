import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

describe.each(["command", "retained", "buffered", "sync"] as const)("opaque CMYK selection (%s)", mode => {
    for (const operator of ["-opaque", "+opaque"]) {
        it.each([
            { space: "CMYK", target: "red", matches: false },
            { space: "CMYK", target: "cyan", matches: false },
            { space: "CMYK", target: "cmyk(0%,100%,100%,0%)", matches: true },
            { space: "sRGB", target: "red", matches: true },
            { space: "CMYK", target: "red", fuzz: "0.000001%", matches: true },
            { space: "CMYK", source: "black", target: "black", matches: true },
            { space: "CMYK", source: "white", target: "white", matches: false },
            { space: "CMYK", source: "#808080", target: "#808080", matches: false },
        ])(`${operator} $target in $space ($fuzz)`, async ({ space, target, matches, source = "red", fuzz = "0" }) => {
            // Native ImageMagick Q16-HDRI: compare sRGB output to isolate selection.
            const argv = [`xc:${source}`, "-colorspace", space, "-fuzz", fuzz, "-fill", "#0000ff80", operator, target,
                "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const argumentValues = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe((operator === "-opaque" ? matches : !matches) ? "0000ff80" : source === "white" ? "ffffffff" : source === "#808080" ? "808080ff" : source === "black" ? "000000ff" : "ff0000ff");
        });
    }
});
