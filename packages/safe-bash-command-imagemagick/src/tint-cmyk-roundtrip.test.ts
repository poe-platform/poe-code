import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, xc:#4278a280, raw 16-bit MSB output.
const tint = ["-fill", "#d65541", "-tint", "30"];
const cases = [
    { name: "tinted CMYK through sRGB back to CMYK", operations: [...tint, "-colorspace", "sRGB", "-colorspace", "CMYK"], format: "cmyka", expected: "6a570071000000008080" },
    { name: "tinted sRGB exported as CMYK", operations: [...tint, "-colorspace", "sRGB"], format: "cmyka", expected: "6a570071000000008080" },
    { name: "tinted inks without conversion", operations: tint, format: "cmyka", expected: "6a570071000000008080" },
    { name: "untinted CMYK round trip", operations: ["-colorspace", "sRGB", "-colorspace", "CMYK"], format: "cmyka", expected: "97b4425f00005d5d8080" },
    { name: "tinted sRGB exported as RGBA", operations: [...tint, "-colorspace", "sRGB"], format: "rgba", expected: "9b72ffffffff8080" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: matches native $name`, async ({ operations, format, expected }) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const target = mode === "command" ? "-" : "/out";
        const argv = ["xc:#4278a280", "-colorspace", "CMYK", ...operations, "-depth", "16", "-endian", "MSB", `${format}:${target}`];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
