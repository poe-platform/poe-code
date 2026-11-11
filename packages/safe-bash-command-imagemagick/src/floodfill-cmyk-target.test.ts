import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

describe.each(["command", "retained", "buffered", "sync"] as const)("CMYK flood-fill selection (%s)", mode => {
    for (const operator of ["-floodfill", "+floodfill"]) {
        it.each([
            { source: "red", target: "red", matches: false },
            { source: "red", target: "cyan", matches: true },
            { source: "red", target: "cmyk(0%,100%,100%,0%)", matches: true },
            { source: "black", target: "black", matches: false },
            { source: "black", target: "cmyk(0%,0%,0%,100%)", matches: true },
            { source: "white", target: "black", matches: true },
            { source: "red", target: "red", fuzz: "99%", matches: false },
            { source: "red", target: "red", fuzz: "100%", matches: true },
            { source: "black", target: "black", fuzz: "99%", matches: false },
            { source: "black", target: "black", fuzz: "100%", matches: true }
        ])(`${operator} $source against $target ($fuzz)`, async ({ source, target, matches, fuzz = "0" }) => {
            // Native Q16-HDRI: alpha isolates selection from replacement ink writing.
            const argv = [`xc:${source}`, "-colorspace", "CMYK", "-fuzz", fuzz, "-fill", "#0000ff80",
                operator, "+0+0", target, "-depth", "8", "cmyka:/out"];
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
            expect(output.length).toBe(5);
            expect(output[4]).toBe((operator === "-floodfill" ? matches : !matches) ? 128 : 255);
        });
    }
});
