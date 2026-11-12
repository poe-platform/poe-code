import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference samples.
const cases = [
    { source: "#123456", background: "gray(50%)", operation: "-splice", geometry: "1x0+1+0", hex: "121234345656800080008000" },
    { source: "#123456", background: "#123456789abc", operation: "-splice", geometry: "1x0+1+0", hex: "121234345656123456789abc" },
    { source: "#123456789abc", background: "gray(50%)", operation: "-splice", geometry: "1x0+1+0", hex: "123456789abc800080008000" },
    { source: "#123456", background: "gray(50%)", operation: "-extent", geometry: "2x1", hex: "121234345656800080008000" },
    { source: "#123456", background: "#808080", operation: "-splice", geometry: "1x0+1+0", hex: "121234345656808080808080" }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: retains $background precision for $source $operation`, async ({ source, background, operation, geometry, hex }) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const args = [`xc:${source}`, "-background", background, operation, geometry, "-depth", "16", "-endian", "MSB", "rgb:-"];
        if (mode === "command") {
            const argumentValues = createCommandArguments(args);
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(result.exitCode).toBe(0);
            expect(stderr).toBe("");
            expect(Buffer.concat(chunks).toString("hex")).toBe(hex);
        } else {
            args[args.length - 1] = "rgb:/out";
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const bytes = mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(bytes).toString("hex")).toBe(hex);
        }
    });
}
