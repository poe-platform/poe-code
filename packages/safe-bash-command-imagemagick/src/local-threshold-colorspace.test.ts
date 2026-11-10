import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes, including alpha.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["HSL", ["-lat", "3x1"], "ffffff00000000ffffffffff"],
        ["Lab", ["-lat", "3x1"], "00ffff009a3200ffff8affff"],
        ["HSL", ["-channel", "A", "-lat", "3x1"], "20709000804020ffa070a0ff"],
        ["Lab", ["-channel", "A", "-lat", "3x1"], "20709000804020ffa070a0ff"],
        ["HSL", [], "20709040804020a0a070a0ee"],
        ["Lab", [], "20709040804020a0a070a0ee"],
        ["sRGB", ["-lat", "3x1"], "00ffff00ff0000ffffffffff"],
    ] as const)(`${mode}: thresholds %s working channels with %j`, async (space, operation, expected) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        const argv = ["xc:#20709040", "xc:#804020a0", "xc:#a070a0ee", "+append",
            "-colorspace", space, ...operation, "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
