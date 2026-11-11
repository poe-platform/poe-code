import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.from("404080207f8081800080ff00fea09fff", "hex");

// ImageMagick 7.1.2-35 Q16-HDRI retains Discrete alpha for range comparisons.
for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    for (const format of ["gray", "rgba"]) {
        it.each([
            { settings: [], expected: "000000ff" },
            { settings: ["-alpha", "discrete"], expected: "000000ff" },
            { settings: ["-alpha", "off"], expected: "ffffffff" },
            { settings: ["-alpha", "deactivate"], expected: "ffffffff" },
            { settings: ["-alpha", "discrete", "-channel", "RGB"], expected: "ffffffff" },
            { settings: ["-alpha", "discrete", "-channel", "A"], expected: "000000ff" },
            { settings: ["-alpha", "off", "-alpha", "discrete"], expected: "ffffffff" },
            { settings: ["-alpha", "disassociate"], expected: "000000ff" },
        ])(`${mode} ${format}: tests retained alpha with $settings and emits an opaque mask`, async ({ settings, expected }) => {
            const files = new Map([["/a.raw", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/a.raw", input);
            const argv = ["-size", "4x1", "-depth", "8", "rgba:/a.raw", ...settings,
                "-color-threshold", "black-white", "-depth", "8", `${format}:-`];
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const argumentValues = createCommandArguments(argv);
            const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }), stderr, stdout: "", stdoutBytes: Buffer.concat(stdout) } : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
            expect(result.stderr).toBe("");
            const mask = Buffer.from(expected, "hex");
            expect(Buffer.from(result.stdoutBytes ?? result.stdout)).toEqual(format === "gray" ? mask
                : Buffer.from([...mask].flatMap(value => [value, value, value, 255])));
        });
    }
}
