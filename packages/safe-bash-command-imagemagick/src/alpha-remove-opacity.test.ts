import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI pixels, including opaque controls.
const cases = [
    ["#e1550a40", "3b3b47a0"],
    ["#e1550a00", "12345680"],
    ["#e1550aff", "794430ff"],
    ["white", "8899aaff"]
] as const;

for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    for (const format of ["rgba", "PNG32"]) {
        it.each(cases)(`${execution} ${format}: composites background %s with its opacity`, async (background, hex) => {
            const argv = ["xc:#12345680", "-background", background, "-alpha", "Remove", "-depth", "8", `${format}:${execution === "command" ? "-" : "out"}`];
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const args = createCommandArguments(argv), chunks: Uint8Array[] = [];
            let stderr = "";
            const result = execution === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : execution === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, execution === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const output = execution === "command" ? Buffer.concat(chunks)
                : execution === "retained" ? await fs.readFile("/out") : files.get("out")!;
            expect(Buffer.from(format === "rgba" ? output : decodeImage(output).data).toString("hex")).toBe(hex);
        });
    }
}
