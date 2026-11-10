import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete raw RGBA output.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["unit scaling", ["-evaluate", "multiply", "1"], [], "00ffff00ff0000ffffffffff"],
        ["twice white", ["-evaluate", "multiply", "2"], [], "00ffff00ff0000ffffffffff"],
        ["four times white", ["-evaluate", "multiply", "4"], [], "00ffff00ff0000ffffffffff"],
        ["sRGB control", ["-colorspace", "sRGB"], ["+channel", "-colorspace", "sRGB"], "00ffff00ff0000ffffffffff"],
        ["negative samples", ["-evaluate", "subtract", "100%"], [], "00ffff00ff0000ffffffffff"],
        ["unselected samples", ["-evaluate", "multiply", "4", "-channel", "R"], ["+channel", "-evaluate", "divide", "4"], "00709040404020a04070a0ee"],
    ] as const)(`thresholds unclipped RGBA samples: %s via ${mode}`, async (_name, before, after, expected) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", files.get("/out")!);
        const args = ["xc:#20709040", "xc:#804020a0", "xc:#a070a0ee", "+append", ...before, "-lat", "3x1", ...after, "-depth", "8", "rgba:/out"];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
