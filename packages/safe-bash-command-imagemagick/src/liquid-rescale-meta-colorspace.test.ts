import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete native ImageMagick 7.1.2-35 Q16-HDRI output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "shrunk Meta0", geometry: "4x3!", separate: true, raw: false, expected: "4x3|Gray|gray  2.1" },
        { name: "enlarged Meta0", geometry: "6x5!", separate: true, raw: false, expected: "6x5|Gray|gray  2.1" },
        { name: "unchanged Meta0", geometry: "5x4!", separate: true, raw: false, expected: "5x4|Gray|gray  2.1" },
        { name: "original Meta0", geometry: "", separate: true, raw: false, expected: "5x4|Gray|gray  2.1" },
        { name: "shrunk Meta0 samples", geometry: "4x3!", separate: true, raw: true, expected: "55555555aaaaaaaaffffffff" },
        { name: "shrunk full image", geometry: "4x3!", separate: false, raw: false, expected: "4x3|sRGB|srgba 5.1" },
    ])(`${mode}: reports $name`, async ({ geometry, separate, raw, expected }) => {
        const argv = ["-size", "5x4", "xc:black", "xc:black", "xc:black", "xc:white", "gradient:black-white", "-combine",
            ...(geometry ? ["-liquid-rescale", geometry] : []),
            ...(separate ? ["-channel", "Meta0", "-separate", "+channel"] : []),
            ...(raw ? ["-depth", "8", "gray:-"] : ["-format", "%wx%h|%[colorspace]|%[channels]", "info:"])];
        const fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = "stdout" in result && typeof result.stdout === "string"
            ? Buffer.concat([Buffer.from(result.stdout), Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : [])])
            : Buffer.concat(chunks);
        expect(output.toString(raw ? "hex" : "utf8")).toBe(expected);
    });
}
