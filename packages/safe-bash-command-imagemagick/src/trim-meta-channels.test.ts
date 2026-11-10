import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference output.
const source = ["(", "xc:white", "-bordercolor", "black", "-border", "1x1", ")",
    "-size", "3x3", "xc:black", "xc:black", "xc:white", "gradient:black-white", "-combine"];
const separate = ["-channel", "Meta0", "-separate", "+channel"];
const cases = [
    { name: "trimmed fifth channel", operations: ["-trim", ...separate], format: "gray", expected: "80" },
    { name: "trimmed RGBA", operations: ["-trim"], format: "rgba", expected: "ff0000ff" },
    { name: "explicitly cropped fifth channel", operations: ["-crop", "1x1+1+1", ...separate], format: "gray", expected: "80" },
    { name: "original fifth channel", operations: separate, format: "gray", expected: "000000808080ffffff" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`${mode}: $name`, async ({ operations, format, expected }) => {
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const argv = [...source, ...operations, "-depth", "8", `${format}:${mode === "command" ? "-" : "/out"}`];
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
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "command" ? Buffer.concat(chunks)
            : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
