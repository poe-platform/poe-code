import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI raw RGBA output, including sRGB controls.
const cases = [
    { space: "HSL", size: "1x1", operation: "Mean", hex: "33b820b7" },
    { space: "Lab", size: "1x1", operation: "Mean", hex: "935269b7" },
    { space: "Lab", size: "2x1", operation: "Max", hex: "c04020edc04020ed" },
    { space: "HSL", size: "2x1", operation: "Max", hex: "2067c0ed2067c0ed" },
    { space: "sRGB", size: "1x1", operation: "Mean", hex: "705068b7" },
    { space: "sRGB", size: "2x1", operation: "Max", hex: "c060b0edc060b0ed" },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`uses reduced $space pixels for $operation with $size inputs (${mode})`, async ({ space, size, operation, hex }) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        const args = ["xc:#2060b080", "-size", size, "xc:#c04020ed", "-colorspace", space,
            "-evaluate-sequence", operation, "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
