import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: border and splice expand every combined plane.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { name: "border extra plane", operations: ["-bordercolor", "black", "-border", "1"], combine: true, channel: "10", expected: "5x4" },
        { name: "splice extra plane", operations: ["-splice", "1x1+1+1"], combine: true, channel: "10", expected: "4x3" },
        { name: "border visible image", operations: ["-bordercolor", "black", "-border", "1"], combine: true, expected: "5x4" },
        { name: "splice visible image", operations: ["-splice", "1x1+1+1"], combine: true, expected: "4x3" },
        { name: "border red plane", operations: ["-bordercolor", "black", "-border", "1"], combine: false, channel: "R", expected: "5x4" },
        { name: "splice red plane", operations: ["-splice", "1x1+1+1"], combine: false, channel: "R", expected: "4x3" },
        { name: "unchanged extra plane", operations: [], combine: true, channel: "10", expected: "3x2" },
        { name: "copy border extra plane", operations: ["-compose", "Copy", "-border", "1"], combine: true, channel: "10", expected: "5x4" },
    ])(`${mode}: $name`, async ({ operations, combine, channel, expected }) => {
        const input = Buffer.from([17, 34, 51, 68, 85, 102].flatMap(value => [value, value, value, 255]));
        const files = new Map([["in.raw", input], ["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const argv = ["-size", "3x2", "-depth", "8", "rgba:in.raw",
            ...(combine ? ["rgba:in.raw", "rgba:in.raw", "xc:white", "rgba:in.raw", "-combine"] : []),
            ...operations, ...(channel ? ["-channel", channel, "-separate", "+channel"] : []),
            "-format", "%wx%h", "info:out"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString()).toBe(expected);
    });
}
