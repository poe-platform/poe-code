import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    for (const operator of ["-level-colors", "+level-colors"] as const) {
        const mapped = operator === "-level-colors" ? "3ebf3ebf3ebfffff" : "764376437643ffff";
        it.each([
            { channel: "Red", expected: mapped },
            { channel: "Gray", expected: mapped },
            { channel: "Green", expected: "666666666666ffff" },
            { channel: "Blue", expected: "666666666666ffff" },
            { channel: "Alpha", expected: "666666666666ffff" },
            { channel: "RGB", expected: mapped },
            { channel: "default", expected: mapped },
            { channel: "Red", expected: "Gray|gray  1.0", info: true },
        ])(`${mode}: ${operator} preserves the single gray channel with $channel ($expected)`, async ({ channel, expected, info }) => {
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const argv = ["xc:gray40", ...(channel === "default" ? [] : ["-channel", channel]),
                operator, "gray30,gray70", "+channel", ...(info
                    ? ["-format", "%[colorspace]|%[channels]", "info:"]
                    : ["-depth", "16", "-endian", "MSB", mode === "magick" || mode === "convert" ? "rgba:-" : "rgba:/out.raw"])];
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "magick" || mode === "convert"
                ? await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                    command: mode, args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                })
                : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            if (info) expect("stdout" in result ? result.stdout : Buffer.concat(chunks).toString()).toBe(expected);
            else {
                const output = mode === "magick" || mode === "convert" ? Buffer.concat(chunks)
                    : mode === "retained" ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
                expect(Buffer.from(output).toString("hex")).toBe(expected);
            }
        });
    }
}
