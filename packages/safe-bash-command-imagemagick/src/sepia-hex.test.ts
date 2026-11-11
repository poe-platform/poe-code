import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: xc:#345caa -sepia-tone VALUE -depth 8 rgb:out.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["0x8000", "e5ce48"],
        ["+0x8000", "e5ce48"],
        ["0X8000", "e5ce48"],
        ["32768", "e5ce48"],
        ["0x4000", "ffff4e"],
        ["16384", "ffff4e"],
        ["0", "ffff59"],
        ["0xcccc", undefined],
    ] as const)(`${mode}: applies sepia threshold %s`, async (threshold, expected) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["xc:#345caa", "-sepia-tone", threshold, "-depth", "8", "rgb:out"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(expected === undefined ? 1 : 0);
        if (expected === undefined) return;
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
