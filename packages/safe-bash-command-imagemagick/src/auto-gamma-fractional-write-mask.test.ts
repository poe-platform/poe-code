import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw 16-bit RGBA output.
const cases = [
    { mask: "gray(50%)", expected: "0f1822ce302660606b5d16b33747bdbd" },
    { mask: "#808080", expected: "0f1c22d9303760606b6916b13749bdbd" },
    { mask: "#7fff7fff7fff", expected: "0f1822ce302660606b5d16b33747bdbd" },
];

for (const height of [1, 257]) for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`retains native $mask write-mask coverage via ${mode} (height=${height})`, async ({ mask, expected }) => {
        const fs = new MemoryFileSystem(), sentinel = new TextEncoder().encode("KEEP");
        await fs.writeFile("/out", sentinel);
        const files = new Map([["/out", sentinel]]);
        const argv = ["-size", `1x${height}`, "xc:#205f9060", "xc:#801238bd", "+append", "(", "-size", `2x${height}`, `xc:${mask}`, "-write", "mpr:m", "+delete", ")", "-write-mask", "mpr:m", "-auto-gamma", "+write-mask", "-depth", "16", "-endian", "MSB", "rgba:/out"];
        if (mode === "command") {
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(stderr).toBe("");
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        }
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected.repeat(height));
    });
}
