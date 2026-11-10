import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw CMYK in MSB order.
const cases = [
    { color: "#405060", depth: 8, expected: "552b009f" },
    { color: "#405060", depth: 16, expected: "55552aab00009f9f" },
    { color: "#405061", depth: 8, expected: "572d009e" },
    { color: "#405061", depth: 16, expected: "57172cde00009e9e" }
];

for (const mode of ["command", "sync"] as const) {
    for (const explicit of [false, true]) {
        it.each(cases)(`${mode}, explicit CMYK=${explicit}: rounds $color at depth $depth`, async ({ color, depth, expected }) => {
            const keep = Buffer.from("KEEP");
            const args = [`xc:${color}`, ...(explicit ? ["-colorspace", "CMYK"] : []), "-depth", String(depth), "-endian", "MSB", "cmyk:out.raw"];
            const files = new Map<string, Uint8Array>([["out.raw", keep]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out.raw", keep);
            let stdout = "", stderr = "";
            const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect("stdout" in result ? result.stdout : stdout).toBe("");
            expect(Buffer.from(mode === "sync" ? files.get("out.raw")! : await fs.readFile("/out.raw")).toString("hex")).toBe(expected);
        });
    }
}
