import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// Full RGBA output from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
    ["3x3-20%", "102030528090a0e8a0b0d0f5"],
    ["3x3+20%", "102030528090a0e8a0b0d0f5"],
    ["3x3-150%", "2636465f708093b39aaac6e1"],
    ["3x3+150%", "2636465f708093b39aaac6e1"],
    ["3x3+150+0%", "2636465f708093b39aaac6e1"],
    ["3x3+150%!", "2636465f708093b39aaac6e1"],
    ["3,3+150%", "2636465f708093b39aaac6e1"],
    ["3/3+150%", "2636465f708093b39aaac6e1"],
    ["3:3+150%", "102030ff8090a0ffa0b0d0ff"],
] as const;

for (const publicCommand of [false, true]) {
    it.each(cases)(`matches native mean-shift geometry %s (public=${publicCommand})`, async (geometry, expected) => {
        const argv = ["xc:#10203012", "xc:#8090a093", "xc:#a0b0d0b5", "+append",
            "-set", "option:win", "3x3+150%", "-mean-shift", geometry, "-depth", "8", "rgba:out"];
        const original = new TextEncoder().encode("KEEP");
        if (!publicCommand) {
            const files = new Map([["out", original]]);
            const result = await runMagickCli(argv, files);
            expect(result.exitCode, result.stderr).toBe(0);
            expect(Buffer.from(files.get("out")!).toString("hex")).toBe(expected);
            return;
        }
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", original);
        const args = createCommandArguments(argv);
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        });
        expect(result.exitCode).toBe(0);
        expect(Buffer.from(await fs.readFile("/out")).toString("hex")).toBe(expected);
    });
}

it.each(["unknown", "3x3+Infinity", "3x3+150%junk", "1001x3-20%", "3:0+150%"])(
    "preserves the destination for invalid or excessive geometry %s", async geometry => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
        const args = createCommandArguments(["xc:red", "-mean-shift", geometry, "-depth", "8", "rgba:out"]);
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        });
        expect(result.exitCode).toBe(1);
        expect(await fs.readFile("/out")).toEqual(new TextEncoder().encode("KEEP"));
    },
);
