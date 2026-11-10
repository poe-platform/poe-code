import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { space: "HSL", expression: "r=>g", expected: "1f4081c0" },
        { space: "Lab", expression: "r=>g", expected: "00829ec0" },
        { space: "HSL", expression: "|r=>g", expected: "1f4081c0" },
        { space: "Lab", expression: "|r=>g", expected: "00829ec0" },
        { space: "HSL", expression: "r=>r", expected: "204080c0" },
        { space: "Lab", expression: "r=>r", expected: "204080c0" },
        { space: "HSL", expression: "", expected: "204080c0" },
        { space: "Lab", expression: "", expected: "204080c0" },
    ])(`assigns working colorspace channels in ${mode}: $space $expression`, async ({ space, expression, expected }) => {
        // Native ImageMagick 7.1.2-35 Q16-HDRI reference outputs.
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["xc:#204080c0", "-colorspace", space, ...(expression.startsWith("|") ? ["-clone", "0"] : []), ...(expression ? ["-channel-fx", expression] : []), "-colorspace", "sRGB", "-depth", "8", mode === "command" ? "rgba:-" : "rgba:/out.rgba"];
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? Buffer.concat(chunks)
            : mode === "retained" ? await fs.readFile("/out.rgba") : files.get("/out.rgba")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
