import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, 8-bit RGBA destination bytes.
const cases = [
    { settings: ["-intensity", "Average"], hex: "555555ff" },
    { settings: ["-intensity", "Brightness"], hex: "ffffffff" },
    { settings: ["-intensity", "Lightness"], hex: "808080ff" },
    { settings: ["-intensity", "RMS"], hex: "939393ff" },
    { settings: ["-intensity", "Rec601Luma"], hex: "4c961dff" },
    { settings: ["-intensity", "Rec709Luma"], hex: "36b612ff" },
    { settings: ["-intensity", "Average", "+intensity"], hex: "36b612ff" },
    { settings: [], hex: "36b612ff" }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: combine honors $settings`, async ({ settings, hex }) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        const argv = ["xc:red", "xc:lime", "xc:blue", ...settings, "-combine", "+intensity", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
