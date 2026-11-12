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

// ImageMagick 7.1.2-35 Q16-HDRI; retain Lab precision through sRGB encoding.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
it.each([
    { operation: "Median", depth: "16", hex: "4041201e100fc0c0" },
    { operation: "Mean", depth: "16", hex: "47a03f294d189898" },
    { operation: "Max", depth: "16", hex: "7b8d548d4223c0c0" },
    { operation: "And", depth: "16", hex: "0000c003ffff4040" },
    { operation: "Median", depth: "8", hex: "402010c0" },
    { operation: "", depth: "16", hex: "4041201e100fc0c0" },
])(`${mode}: retains Lab samples with $operation at depth $depth`, async ({ operation, depth, hex }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const colors = operation ? ["#2f609070", "#402010c0"] : ["#402010c0"];
    const argv = [...colors.flatMap(color => ["(", `xc:${color}`, "-colorspace", "Lab", ")"]),
        ...(operation ? ["-evaluate-sequence", operation] : []), "-colorspace", "sRGB", "-depth", depth, "-endian", "MSB", "rgba:/out"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(hex);
});
