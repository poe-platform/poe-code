import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: Gray and LinearGray have only one color channel.
const cases = [
    ...["Gray", "LinearGray"].flatMap(space => [
        { space, channel: "R", expected: space === "Gray" ? "99999980" : "efefef80" },
        { space, channel: "G", expected: "66666680" },
        { space, channel: "B", expected: "66666680" },
        { space, channel: "A", expected: "6666667f" },
        { space, channel: "RGB", expected: space === "Gray" ? "99999980" : "efefef80" },
    ]),
    { space: "sRGB", channel: "R", expected: "99666680" },
    { space: "sRGB", channel: "G", expected: "66996680" },
    { space: "sRGB", channel: "B", expected: "66669980" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["-negate", "+negate"]) {
        it.each(cases)(`${mode}: ${operation} selects $channel in $space`, async ({ space, channel, expected }) => {
            const files = new Map<string, Uint8Array>();
            const fs = new MemoryFileSystem();
            const args = ["xc:#66666680", "-colorspace", space, "-channel", channel, operation,
                "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result.exitCode, stderr).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
