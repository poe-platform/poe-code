import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, including the small liquid-rescale fallback.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { operation: ["-resize", "2x2!"], separate: true, format: "gray", expected: "3a3ac5c5" },
        { operation: ["-liquid-rescale", "2x2!"], separate: true, format: "gray", expected: "3a3ac5c5" },
        { operation: ["-resize", "4x3!"], separate: true, format: "gray", expected: "1616161680808080e9e9e9e9" },
        { operation: ["-liquid-rescale", "3x2!"], separate: true, format: "info", expected: "3x2|Gray|gray  2.1" },
        { operation: ["-liquid-rescale", "2x3!"], separate: true, format: "info", expected: "2x3|Gray|gray  2.1" },
        { operation: ["-liquid-rescale", "2x2!"], separate: false, format: "info", expected: "2x2|sRGB|srgba 5.1" },
        { operation: ["-liquid-rescale", "4x3!"], separate: true, format: "gray", expected: "55555555aaaaaaaaffffffff" },
        { operation: [], separate: true, format: "gray", expected: "00000000005555555555aaaaaaaaaaffffffffff" },
    ])(`${mode}: $operation separate=$separate $format`, async ({ operation, separate, format, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = ["-size", "5x4", "xc:black", "xc:black", "xc:black", "xc:white", "gradient:black-white", "-combine",
            ...operation, ...(separate ? ["-channel", "Meta0", "-separate", "+channel"] : []),
            "-depth", "8", "-format", "%wx%h|%[colorspace]|%[channels]", `${format}:${mode === "command" ? "-" : "/out"}`];
        const argumentValues = createCommandArguments(args);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            signal: new AbortController().signal,
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "command" ? Buffer.concat(chunks)
            : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!);
        expect(output.toString(format === "gray" ? "hex" : "utf8")).toBe(expected);
    });
}
