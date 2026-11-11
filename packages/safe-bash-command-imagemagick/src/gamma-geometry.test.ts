import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick RGBA8 output for xc:#4080c080.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ...["2x3+1+2", "2:3", "2%", "2,", "2", "0x2", "0x2,3"].map(value => ["-gamma", value, "80b5ddb5"]),
        ...["-gamma", "+gamma"].flatMap(option =>
            ["2 3 4", "2 0", "  2  3 4  ", "2\t3\n4", "0x2 3", "2e0 3"].map(value =>
                [option, value, option === "-gamma" ? "80b5ddb5" : "10409140"])),
        ["-gamma", "23", "f0f7fcf7"],
        ["+gamma", "23", "00000000"],
        ["-gamma", "x2", "00000000"],
        ["+gamma", "2!", "10409140"],
        ["+gamma", "2", "10409140"],
        ...["-gamma", "+gamma"].flatMap(option =>
            ["2foo", "2x3junk", "2e", "", "bogus", "2 bogus", "2 3junk", "2e 3"].map(value => [option, value, ""])),
    ])(`${mode}: %s %s matches native gamma geometry`, async (option, value, expected) => {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", sentinel]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", sentinel);
        const argv = ["xc:#4080c080", option!, value!, "-depth", "8", "rgba:/out"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(result.exitCode).toBe(expected ? 0 : 1);
        expect(Buffer.from(output).toString("hex")).toBe(expected || "4b454550");
    });
}
