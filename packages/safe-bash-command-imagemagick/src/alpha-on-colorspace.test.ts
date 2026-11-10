import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    for (const colorspace of ["HSL", "Lab", "sRGB", "CMYK"]) {
        // ImageMagick 7.1.2-35 Q16-HDRI: On/Set initialize discarded alpha; Activate does not.
        it.each([
            { before: ["-alpha", "off"], mode: "on", expected: "123456ff" },
            { before: ["-alpha", "off"], mode: "set", expected: "123456ff" },
            { before: ["-alpha", "off"], mode: "activate", expected: "12345600" },
            { before: [], mode: "on", expected: "12345640" },
        ])(`${execution}: ${colorspace} $before then alpha $mode`, async ({ before, mode, expected }) => {
            const argv = ["xc:#12345640", "-colorspace", colorspace, ...before,
                "-alpha", mode, "-colorspace", "sRGB", "-depth", "8", execution === "command" ? "rgba:-" : "rgba:/out"];
            const filesystem = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>();
            const argumentValues = createCommandArguments(argv);
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result = execution === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : execution === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, execution === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = execution === "command" ? Buffer.concat(chunks)
                : execution === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
