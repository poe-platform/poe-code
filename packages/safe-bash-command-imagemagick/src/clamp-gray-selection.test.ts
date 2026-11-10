import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7 Q16-HDRI RGB8 results, including untouched gray pixels.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const selection of ["region", "mask", "none"] as const) {
        it.each(["R", "G", "B", "RGB"])(`${mode}: grayscale clamp with ${selection} and channel %s`, async channel => {
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const argv = [
                ...(selection === "mask" ? ["(", "xc:white", "xc:black", "xc:white", "+append", "-write", "mpr:mask", "+delete", ")"] : []),
                "xc:#465689", "xc:#796589", "xc:#cabfad", "+append", "-colorspace", "Gray", "-channel", channel,
                "-evaluate", "multiply", "4",
                ...(selection === "region" ? ["-region", "1x1+1+0"] : selection === "mask" ? ["-write-mask", "mpr:mask"] : []),
                "-clamp",
                ...(selection === "region" ? ["+region"] : selection === "mask" ? ["+write-mask"] : []),
                "-evaluate", "divide", "4", "+channel", "-colorspace", "sRGB", "-depth", "8", "rgb:/out",
            ];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            const expected = channel === "G" || channel === "B" ? "5656566c6c6cc0c0c0"
                : selection === "none" ? "404040404040404040" : "565656404040c0c0c0";
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        });
    }
}
