import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const blackFrames = [
    "(", "xc:black", "-duplicate", "3", "xc:#404040", "-combine", ")",
    "(", "xc:black", "-duplicate", "3", "xc:#808080", "-combine", ")",
];
const cases = [
    { name: "Mean Meta0", operation: "Mean", channel: "Meta0", expected: "60" },
    { name: "Max Meta0", operation: "Max", channel: "Meta0", expected: "80" },
    { name: "Min control", operation: "Min", channel: "Meta0", expected: "40" },
    { name: "red control", operation: "Mean", channel: "R", expected: "00" },
    { name: "Mean Meta1", operation: "Mean", channel: "Meta1", expected: "96", frames: [
        "(", ...["101010", "202020", "303030", "404040", "505050", "606060"].map(color => `xc:#${color}`), "-combine", ")",
        "(", ...["111111", "444444", "666666", "888888", "aaaaaa", "cccccc"].map(color => `xc:#${color}`), "-combine", ")",
    ] },
    { name: "Mean across chunks and rows", operation: "Mean", channel: "Meta0", size: "513x2", expected: "60".repeat(1026) },
    { name: "Mean 16-bit precision", operation: "Mean", channel: "Meta0", depth: "16", expected: "1235", frames: [
        "(", "xc:black", "-duplicate", "3", "xc:#123412341234", "-combine", ")",
        "(", "xc:black", "-duplicate", "3", "xc:#123612361236", "-combine", ")",
    ] },
];

// The first five cases reproduce ImageMagick 7.1.2-35 Q16-HDRI results.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`${mode}: $name`, async ({ operation, channel, expected, frames = blackFrames, size = "1x1", depth = "8" }) => {
        const files = new Map([["out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
        await fs.writeFile("/out", Buffer.from("KEEP"));
        const argv = ["-size", size, ...frames, "-evaluate-sequence", operation, "+channel", "-channel", channel, "-separate", "+channel", "-depth", depth, "-endian", "MSB", "gray:out"];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const bytes = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
