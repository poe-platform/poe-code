import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, starting with xc:#4080a080.
const tint = ["-fill", "#bf6050", "-tint", "60%"];
const cases = [
    { name: "untinted 16-bit control", operations: [], depth: "16", expected: "40408080a0a08080" },
    { name: "fractional tint", operations: tint, depth: "16", expected: "3fea46d461b08080" },
    { name: "tint followed by identity arithmetic", operations: [...tint, "-evaluate", "Add", "0"], depth: "16", expected: "3fea46d461b08080" },
    { name: "tint followed by multiplication", operations: [...tint, "-evaluate", "Multiply", "0.75"], depth: "16", expected: "2fef351f49446060" },
    { name: "untinted multiplication control", operations: ["-evaluate", "Multiply", "0.75"], depth: "16", expected: "3030606078786060" },
    { name: "8-bit tint control", operations: ["-colorspace", "sRGB", "-fill", "#bf605040", "-tint", "60%", "-colorspace", "sRGB"], depth: "8", expected: "40476180" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: preserves tint precision for $name`, async ({ operations, depth, expected }) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const argv = ["xc:#4080a080", ...operations, "-depth", depth, "-endian", "MSB", mode === "command" ? "rgba:-" : "rgba:/out"];
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
        const output = mode === "command" ? Buffer.concat(stdout)
            : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
