import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: inactive alpha must not erase visible color boundaries.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { alpha: ["-alpha", "off"], method: "floodfill", expected: "ff0000ff000000ff204060ff" },
        { alpha: ["-alpha", "off"], method: "replace", expected: "ff0000ff000000ffff0000ff" },
        { alpha: ["-alpha", "off"], method: "point", expected: "ff0000ff000000ff204060ff" },
        { alpha: [], method: "floodfill", expected: "ff0000ff000000ff20406080" },
        { alpha: [], method: "replace", expected: "ff0000ff000000ffff0000ff" },
        { alpha: ["-alpha", "opaque"], method: "floodfill", expected: "ff0000ff000000ff204060ff" }
    ])(`${mode}: color $method with $alpha respects visible color boundaries`, async ({ alpha, method, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = ["xc:#20406080", "xc:#000000ff", "xc:#20406080", "+append", ...alpha,
            "-fill", "red", "-draw", `color 0,0 ${method}`, "-depth", "8", "rgba:out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
