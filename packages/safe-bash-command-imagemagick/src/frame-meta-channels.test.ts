import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: decorations pad extra planes with zero.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { operations: ["-frame", "1x1"], channel: "10", expected: "000000000000ff0000000000" },
        { operations: ["-frame", "1x1"], channel: "R", expected: "bdbdbdbdbd0000bdbdbdbdbd" },
        { operations: ["-border", "1"], channel: "10", expected: "000000000000ff0000000000" },
        { operations: [], channel: "10", expected: "00ff" },
    ])(`${mode}: $operations channel $channel`, async ({ operations, channel, expected }) => {
        const argv = ["-size", "2x1", "xc:black", "xc:black", "xc:black", "xc:white", "gradient:black-white", "-combine",
            ...operations, "-channel", channel, "-separate", "+channel", "-depth", "8", "gray:out"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
