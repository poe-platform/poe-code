import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, xc:#4080a080, raw 8-bit output.
const cases = [
    { name: "CMYK round-trip control", operations: ["-colorspace", "CMYK", "-colorspace", "sRGB"], format: "rgba", expected: "4080a080" },
    { name: "untinted inks control", operations: ["-colorspace", "CMYK"], format: "cmyk", expected: "9933005f" },
    { name: "tinted CMYK converted to sRGB", operations: ["-colorspace", "CMYK", "-fill", "#bf605040", "-tint", "60%", "-colorspace", "sRGB"], format: "rgba", expected: "6bfdff80" },
    { name: "tinted inks", operations: ["-colorspace", "CMYK", "-fill", "#bf605040", "-tint", "60%"], format: "cmyk", expected: "990e0000" },
    { name: "sRGB tint control", operations: ["-colorspace", "sRGB", "-fill", "#bf605040", "-tint", "60%", "-colorspace", "sRGB"], format: "rgba", expected: "40476180" },
];

for (const mode of ["magick", "convert", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: $name`, async ({ operations, format, expected }) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const argv = ["xc:#4080a080", ...operations, "-depth", "8", `${format}:/out`];
        const args = createCommandArguments(argv);
        let stderr = "";
        const command = mode === "magick" || mode === "convert";
        const result = command ? await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = command || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
