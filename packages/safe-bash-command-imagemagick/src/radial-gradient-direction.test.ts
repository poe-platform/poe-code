import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, 4x3 gray bytes in row order.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { options: [], expected: "ffbebeffff5555ffffbebeff" },
        { options: ["-define", "gradient:direction=East"], expected: "ff5555ffffbebeffffffffff" },
        { options: ["-define", "gradient:direction=West"], expected: "00aaffffaaf0ffffffffffff" },
        { options: ["-define", "gradient:direction=North"], expected: "00aaffffaaf0ffffffffffff" },
        { options: ["-define", "gradient:direction=South"], expected: "aaf0ffff00aaffffaaf0ffff" },
        { options: ["-define", "gradient:direction=NorthEast"], expected: "ff5555ffffbebeffffffffff" },
        { options: ["-define", "gradient:direction=NorthWest"], expected: "00aaffffaaf0ffffffffffff" },
        { options: ["-define", "gradient:direction=SouthEast"], expected: "ffbebeffff5555ffffbebeff" },
        { options: ["-define", "gradient:direction=SouthWest"], expected: "aaf0ffff00aaffffaaf0ffff" },
        { options: ["-define", "gradient:direction=Center"], expected: "ffbebeffff5555ffffbebeff" },
        { options: ["-define", "gradient:direction=bogus"], expected: "ffbebeffff5555ffffbebeff" },
        { options: ["-define", "gradient:center=0,0"], expected: "00aaffffaaf0ffffffffffff" },
        { options: ["-define", "gradient:direction=East", "-define", "gradient:center=0,0"], expected: "00aaffffaaf0ffffffffffff" },
        { options: ["-define", "gradient:direction=East", "-define", "gradient:angle=0"], expected: "ff5555ffffbebeffffffffff" },
        { options: ["-define", "gradient:direction=East", "-define", "gradient:vector=0,0,2,0"], expected: "aa00aafff0aaf0ffffffffff" },
        { options: ["-define", "gradient:direction=East", "+define", "gradient:direction"], expected: "ffbebeffff5555ffffbebeff" },
    ])(`${mode}: radial gradient $options`, async ({ options, expected }) => {
        const argv = ["-size", "4x3", ...options, "radial-gradient:black-white", "-depth", "8", "gray:-"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        const stdout: Buffer[] = [], stderr: Buffer[] = [];
        let bytes: Buffer;
        if (mode === "command") {
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
                stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
            });
            expect(result.exitCode).toBe(0);
            expect(Buffer.concat(stderr).toString()).toBe("");
            bytes = Buffer.concat(stdout);
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            bytes = Buffer.from(result.stdoutBytes ?? result.stdout);
        }
        expect(bytes.toString("hex")).toBe(expected);
    });
}
