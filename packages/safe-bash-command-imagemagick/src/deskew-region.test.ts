import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI reference bytes for a 2x1 red canvas.
const unmasked = "fffffffffff7f7fffff7f7ffffffffffffefefffff1010ffff1010ffffefeffffffffffffff7f7fffff7f7ffffffffff";
const cases = [
    { name: "edit after deskew", operations: ["-deskew", "40%", "-evaluate", "Set", "0", "+region"], expected: "000000ff".repeat(12) },
    { name: "retained mask export", operations: ["-deskew", "40%"], expected: "ffffff00fff7f700fff7f700ffffff00ffefef00ff101000ff101000ffefef00ffffff00fff7f700fff7f700ffffff00" },
    { name: "cleared mask export", operations: ["-deskew", "40%", "+region"], expected: unmasked },
    { name: "region without deskew", operations: ["-evaluate", "Set", "0", "+region"], expected: "ff0000ff000000ff" },
    { name: "deskew geometry", operations: ["-deskew", "40%", "-format", "%wx%h:%g:%[deskew:angle]"], expected: "4x3:4x3-1-1:-0", info: true }
];
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const selection of [["-region", "1x1+1+0"], ["-write-mask", "/mask.pgm"]]) {
        it.each(cases)(`${mode} ${selection[0]}: $name`, async ({ operations, expected, info }) => {
            const files = new Map<string, Uint8Array>([["/mask.pgm", Buffer.concat([Buffer.from("P5\n2 1\n255\n"), Buffer.from([255, 0])])]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/mask.pgm", files.get("/mask.pgm")!);
            const args = ["-size", "2x1", "xc:red", ...selection, ...operations, "-depth", "8", `${info ? "info" : "rgba"}:/out`];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString(info ? "utf8" : "hex")).toBe(expected);
        });
    }
}
