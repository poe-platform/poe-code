import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: xc:#345ca980 -fill FILL OPERATION 60 -depth 8 rgba:-.
const cases = [
    { fill: "lab(50,20,-30)", operation: "-tint", expected: "0b2d6080" },
    { fill: "lab(50,20,-30)", operation: "-colorize", expected: "617d7e80" },
    { fill: "lab(50%,20,-30)", operation: "-tint", expected: "3d063b80" },
    { fill: "cielab(50,20,-30)", operation: "-tint", expected: "0b2d6080" },
    { fill: "cielab(50,20,-30)", operation: "-colorize", expected: "617d7e80" },
    { fill: "#7f6daa", operation: "-tint", expected: "192c9b80" },
    { fill: "#7f6daa", operation: "-colorize", expected: "6166aa80" },
    { fill: "hsl(20,50%,30%)", operation: "-tint", expected: "313c7c80" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const format of ["rgba", "PNG32"]) {
        it.each(cases)(`${mode} ${format}: $operation with $fill`, async ({ fill, operation, expected }) => {
            const fs = new MemoryFileSystem();
            const args = ["xc:#345ca980", "-fill", fill, operation, "60", "-depth", "8", `${format}:-`];
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, new Map())
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = mode === "command" ? Buffer.concat(chunks)
                : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
            expect(Buffer.from(format === "rgba" ? bytes : decodeImage(bytes).data).toString("hex")).toBe(expected);
        });
    }
}
