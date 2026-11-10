import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Uint8Array.from([17, 34, 51, 68, 85, 102].flatMap(value => [value, value, value, 255]));
const cases = [
    { name: "unchanged", operation: [], hex: "112233445566", size: "3x2" },
    { name: "transpose", operation: ["-transpose"], hex: "114422553366", size: "2x3" },
    { name: "transverse", operation: ["-transverse"], hex: "663355224411", size: "2x3" },
    { name: "rotate 90", operation: ["-rotate", "90"], hex: "441155226633", size: "2x3" },
    { name: "rotate 180", operation: ["-rotate", "180"], hex: "665544332211", size: "3x2" },
    { name: "rotate 270", operation: ["-rotate", "270"], hex: "336622551144", size: "2x3" },
    { name: "auto-orient transpose", operation: ["-orient", "LeftTop", "-auto-orient"], hex: "114422553366", size: "2x3" },
    { name: "auto-orient transverse", operation: ["-orient", "RightBottom", "-auto-orient"], hex: "663355224411", size: "2x3" },
    { name: "flip", operation: ["-flip"], hex: "445566112233", size: "3x2" },
    { name: "flop", operation: ["-flop"], hex: "332211665544", size: "3x2" },
];
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`${mode}: $name keeps meta channels aligned`, async ({ operation, hex, size }) => {
        for (const channel of ["10", "R"]) {
            for (const dimensions of [false, true]) {
                const args = ["-size", "3x2", "-depth", "8", "rgba:in.raw", "rgba:in.raw", "rgba:in.raw", "xc:white", "rgba:in.raw", "-combine", ...operation,
                    "-channel", channel, "-separate", "+channel", ...(dimensions ? ["-format", "%wx%h", "info:out"] : ["-depth", "8", "gray:out"])];
                const files = new Map([["in.raw", input], ["out", new TextEncoder().encode("KEEP")]]);
                const fs = new MemoryFileSystem();
                for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args, cwd: "/", env: {}, fs,
                    stdin: (async function* () {})(), stdout: { async write() {} },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                    signal: new AbortController().signal,
                }) : mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                expect(result.exitCode).toBe(0);
                const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
                expect(Buffer.from(output).toString(dimensions ? "utf8" : "hex"), `channel ${channel}`).toBe(dimensions ? size : hex);
            }
        }
    });
}
