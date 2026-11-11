import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI results.
for (const route of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { alphaOn: false, weights: "30x70", operation: "-composite", hex: "69646bff", channels: "srgb  3.0" },
        { alphaOn: false, weights: "100x100", operation: "-composite", hex: "c06020ff", channels: "srgb  3.0" },
        { alphaOn: true, weights: "30x70", operation: "-composite", hex: "69646bc9", channels: "srgba 4.0" },
        { alphaOn: false, weights: "30x70", operation: "-flatten", hex: "b89988af", channels: "srgba 4.0" }
    ])(`${route}: $operation $weights with destination alpha=$alphaOn`, async ({ alphaOn, weights, operation, hex, channels }) => {
        for (const format of [false, true]) {
            const fs = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>();
            const argv = ["(", "xc:#336699", ...(alphaOn ? ["-alpha", "on"] : []), ")", "xc:#c06020",
                "-compose", "Dissolve", "-define", `compose:args=${weights}`, operation,
                ...(format ? ["-format", "%[channels]", "info:/out"] : ["-depth", "8", "rgba:/out"])];
            const args = createCommandArguments(argv);
            const result = route === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : route === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, route === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = route === "command" || route === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString(format ? "utf8" : "hex")).toBe(format ? channels : hex);
        }
    });
}
