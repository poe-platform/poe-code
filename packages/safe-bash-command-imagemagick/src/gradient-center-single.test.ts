import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, 5x3 gray bytes in row order.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { options: ["-define", "gradient:center=1"], expected: "b480b4ffff800080ffffb480b4ffff" },
        { options: ["-define", "gradient:center=1,1"], expected: "b480b4ffff800080ffffb480b4ffff" },
        { options: ["-define", "gradient:center=1", "-define", "gradient:direction=East"], expected: "800080ffffb480b4ffffffffffffff" },
        { options: ["-define", "gradient:center=1", "-size", "5x5"], expected: "ffffffffffb480b4ffff800080ffffb480b4ffffffffffffff" },
        { options: ["-define", "gradient:center=1", "+define", "gradient:center"], expected: "ffb480b4ffff800080ffffb480b4ff" },
        { options: ["-define", "gradient:center=4,2", "-define", "gradient:center=1"], expected: "b480b4ffff800080ffffb480b4ffff" },
        { options: ["-define", "gradient:center=1", "-define", "gradient:vector=0,0,4,0"], expected: "800080ffffb480b4ffffffffffffff" },
        { options: ["-define", "gradient:center=0.5"], expected: "8f8fe6ffff4040bfffff8f8fe6ffff" },
        { options: ["-define", "gradient:center=-1"], expected: "b4ffffffff80ffffffffb4ffffffff" },
    ])(`${mode}: radial center $options`, async ({ options, expected }) => {
        const argv = ["-size", "5x3", ...options, "radial-gradient:black-white", "-depth", "8", "gray:-"];
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
